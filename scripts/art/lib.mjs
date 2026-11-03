// Shared helpers of the art pipeline (#177): manifest and index reading, validation and the file layout.
// Used by gen.mjs, sheet.mjs and artcheck.mjs. Node only.
import {readFileSync,existsSync,readdirSync,statSync,writeFileSync,mkdirSync,renameSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {pngSize} from './png.mjs';

export const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..','..');
export const MANIFEST=join(ROOT,'scripts','art','manifest.json');
export const ASSETS=join(ROOT,'assets');
export const KINDS=['tile','autotile','building','landmark','sprite','portrait','prop','icon'];
const ID=/^([a-z]+):([a-z0-9][a-z0-9-]*)$/;

export const loadManifest=(p=MANIFEST)=>JSON.parse(readFileSync(p,'utf8'));
// 'tile:grass' -> 'tile/grass.png' (relative to the assets folder; the same path the browser asks for).
export function fileOf(id){const m=ID.exec(id);if(!m)throw new Error('bad asset id '+id);return `${m[1]}/${m[2]}.png`}
export const sha256=b=>createHash('sha256').update(b).digest('hex');

export function loadIndex(dir=ASSETS){const p=join(dir,'index.json');
  if(!existsSync(p))return {version:1,assets:{}};const j=JSON.parse(readFileSync(p,'utf8'));j.assets=j.assets||{};return j}

// Problems with the manifest itself (shape, ids, models, palettes). PAL = the palette.js module namespace.
export function validateManifest(man,PAL,resolvePalette){
  const errs=[],seen=new Set();
  if(!man||!Array.isArray(man.assets))return ['manifest has no assets list'];
  for(const [k,m] of Object.entries(man.models||{})){if(!m.repo||!/^[\w.-]+\/[\w.-]+$/.test(m.repo))errs.push(`model ${k}: repo missing or bad`);
    if(!(m.width>0&&m.height>0))errs.push(`model ${k}: width/height`);if(typeof m.costPerImage!=='number')errs.push(`model ${k}: costPerImage must be a number`)}
  for(const k of man.candidates||[])if(!(man.models||{})[k])errs.push(`candidates: unknown model ${k}`);
  if(!(man.candidates||[]).length)errs.push('candidates: list the models to try, best first');
  if(man.pinnedModel&&!(man.models||{})[man.pinnedModel])errs.push(`pinnedModel: unknown model ${man.pinnedModel}`);
  for(const e of man.assets){const m=ID.exec(e.id||'');
    if(!m){errs.push(`bad id ${e.id}`);continue}
    if(seen.has(e.id))errs.push(`duplicate id ${e.id}`);seen.add(e.id);
    if(!KINDS.includes(e.kind))errs.push(`${e.id}: unknown kind ${e.kind}`);else if(m[1]!==e.kind)errs.push(`${e.id}: kind ${e.kind} differs from the id prefix`);
    if(!Array.isArray(e.size)||e.size.length!==2||!e.size.every(v=>Number.isInteger(v)&&v>0&&v<=256))errs.push(`${e.id}: size must be [w,h] 1..256`);
    if(e.model!==undefined&&!(man.models&&man.models[e.model]))errs.push(`${e.id}: unknown model ${e.model}`);
    if(!Number.isInteger(e.priority)||!(man.priorities||[]).some(p=>p.n===e.priority))errs.push(`${e.id}: priority must be one of priorities[].n`);
    if(typeof e.prompt!=='string'||e.prompt.length<8)errs.push(`${e.id}: prompt missing`);
    if(!Number.isInteger(e.seed))errs.push(`${e.id}: seed must be an integer`);
    if(!e.hook||!e.hook.module||!e.hook.export)errs.push(`${e.id}: hook {module, export} missing`);
    if(PAL&&resolvePalette){const {colors,missing}=resolvePalette(e.palette,PAL);
      if(missing.length)errs.push(`${e.id}: palette paths or colours not found: ${missing.join(', ')}`);
      if(colors.length<2)errs.push(`${e.id}: palette has ${colors.length} colours (need 2+)`)}}
  return errs}

// Every manifest id must be named by its hook's fallback table (the renderer that draws it procedurally).
export async function checkHooks(man){
  const errs=[],mods=new Map();
  for(const e of man.assets){const h=e.hook||{};if(!h.module)continue;
    let mod=mods.get(h.module);if(!mod){try{mod=await import(pathToFileURL(join(ROOT,h.module)).href)}catch(err){errs.push(`${e.id}: hook module ${h.module} failed to load: ${err.message}`);mod={}}mods.set(h.module,mod)}
    const tab=mod[h.export];if(!tab||typeof tab!=='object')errs.push(`${e.id}: ${h.module} has no export ${h.export}`);
    else if(!(e.id in tab))errs.push(`${e.id}: no procedural fallback in ${h.module} ${h.export}`)}
  return errs}

// Problems between assets/index.json, the PNG files and the manifest. An absent assets folder is fine.
export function checkIndex(man,dir=ASSETS){
  const errs=[],idx=loadIndex(dir),byId=new Map(man.assets.map(e=>[e.id,e])),listed=new Set();
  for(const [id,a] of Object.entries(idx.assets)){
    const e=byId.get(id);if(!e){errs.push(`index: ${id} is not in the manifest`);continue}
    if(a.file!==fileOf(id))errs.push(`index: ${id} file ${a.file}, expected ${fileOf(id)}`);
    listed.add(a.file);const p=join(dir,a.file);
    if(!existsSync(p)){errs.push(`index: ${id} file ${a.file} is missing`);continue}
    const b=readFileSync(p),sz=pngSize(b);
    if(!sz){errs.push(`${a.file}: not a PNG`);continue}
    if(sz.w!==e.size[0]||sz.h!==e.size[1])errs.push(`${a.file}: ${sz.w}x${sz.h}, manifest says ${e.size.join('x')}`);
    if(a.w!==sz.w||a.h!==sz.h)errs.push(`index: ${id} size ${a.w}x${a.h} differs from the file ${sz.w}x${sz.h}`);
    if(a.sha256!==sha256(b))errs.push(`index: ${id} sha256 differs from ${a.file} (regenerate the index)`)}
  // stray PNGs nobody indexed
  if(existsSync(dir))for(const k of readdirSync(dir)){const sub=join(dir,k);if(k==='incoming'||!statSync(sub).isDirectory())continue; // incoming/<date>/ awaits review
    for(const f of readdirSync(sub))if(f.endsWith('.png')&&!listed.has(`${k}/${f}`))errs.push(`assets/${k}/${f} is not in assets/index.json`)}
  return {errs,count:Object.keys(idx.assets).length}}

// assets/queue.json: the daily run's local state (gitignored): the model that answered, what waits in
// assets/incoming/<date>/ for review, what failed and why, rejected redraws, alternates made, what is next.
export const QUEUE0=()=>({version:1,model:{pinned:null,tried:{}},incoming:{},failed:{},rejected:{},alts:{},next:[],lastRun:null});
export function loadQueue(dir=ASSETS){const p=join(dir,'queue.json');if(!existsSync(p))return QUEUE0();
  const q={...QUEUE0(),...JSON.parse(readFileSync(p,'utf8'))};q.model={pinned:null,tried:{},...(q.model||{})};return q}
export function saveQueue(dir,q){mkdirSync(dir,{recursive:true});const p=join(dir,'queue.json');writeFileSync(p+'.tmp',JSON.stringify(q,null,1)+'\n');renameSync(p+'.tmp',p)}
// 'tile:grass#alt2' -> {id:'tile:grass', alt:2}; the file of an alternate is <kind>/<name>.alt2.png.
export function splitKey(k){const m=/^(.*?)(?:#alt(\d+))?$/.exec(k);return {id:m[1],alt:m[2]?Number(m[2]):0}}
export function keyFile(k){const {id,alt}=splitKey(k);const f=fileOf(id);return alt?f.replace(/\.png$/,`.alt${alt}.png`):f}
