// Shared helpers of the art pipeline (#177): manifest and index reading, validation and the file layout.
// Used by gen.mjs, sheet.mjs and artcheck.mjs. Node only.
import {readFileSync,existsSync,readdirSync,statSync,writeFileSync,mkdirSync,renameSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {pngSize} from './png.mjs';
import {TILE,TIERS} from '../../src/render/tile.js';

export const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..','..');
export const MANIFEST=join(ROOT,'scripts','art','manifest.json');
export const ASSETS=join(ROOT,'assets');
export const KINDS=['tile','autotile','building','landmark','sprite','portrait','prop','icon'];
const ID=/^([a-z]+):([a-z0-9][a-z0-9-]*)$/;

export const loadManifest=(p=MANIFEST)=>JSON.parse(readFileSync(p,'utf8'));
// Tiers (#177, src/render/tile.js): the renderer draws the assets of its TILE size; every asset is made per tier from the
// same manifest entry (sizes per tier, same prompt and seed) with the tier's generation settings (manifest tiers).
export {TILE,TIERS};
export const LEGACY_TIER=32; // index entries and queue keys made before tiers were 32 px art
// ('tile:grass', 32) -> 'tile/32/grass.png' (relative to the assets folder; the same path the browser asks for).
export function fileOf(id,tier=TILE){const m=ID.exec(id);if(!m)throw new Error('bad asset id '+id);return `${m[1]}/${tier}/${m[2]}.png`}
export const sha256=b=>createHash('sha256').update(b).digest('hex');
// The key of an asset at a tier in the index and the queue: 'tile:grass@32' (an alternate: 'tile:grass@32#alt1').
export const tierKey=(id,tier=TILE,alt=0)=>`${id}@${tier}`+(alt?`#alt${alt}`:'');
// A key from before tiers ('tile:grass', 'tile:grass#alt1') -> the same at LEGACY_TIER.
export const normKey=(k,tier=LEGACY_TIER)=>/@\d+(#|$)/.test(k)?k:k.replace(/^([^#]*)/,`$1@${tier}`);
// Pixel size of a manifest entry at a tier, or null.
export const sizeOf=(e,tier=TILE)=>(e&&e.sizes&&e.sizes[tier])||null;
// The generation settings of a tier for a model: the manifest's tiers[tier], overridden by the model's own tiers[tier].
export const tierCfg=(man,m,tier=TILE)=>({...((man&&man.tiers&&man.tiers[tier])||{}),...((m&&m.tiers&&m.tiers[tier])||{})});

// An index with every key at its tier: an entry from before tiers ('tile:grass') becomes 'tile:grass@32' with tier 32.
export function loadIndex(dir=ASSETS){const p=join(dir,'index.json');
  if(!existsSync(p))return {version:1,assets:{}};const j=JSON.parse(readFileSync(p,'utf8')),out={};
  for(const [k,a] of Object.entries(j.assets||{})){const tier=Number.isInteger(a&&a.tier)?a.tier:(/@(\d+)/.exec(k)||[])[1]?Number(/@(\d+)/.exec(k)[1]):LEGACY_TIER;
    out[normKey(k,tier)]={...a,tier}}
  j.assets=out;return j}

// Problems with the manifest itself (shape, ids, models, palettes). PAL = the palette.js module namespace.
export function validateManifest(man,PAL,resolvePalette){
  const errs=[],seen=new Set();
  if(!man||!Array.isArray(man.assets))return ['manifest has no assets list'];
  for(const [k,m] of Object.entries(man.models||{})){if(!m.repo||!/^[\w.-]+\/[\w.-]+$/.test(m.repo))errs.push(`model ${k}: repo missing or bad`);
    if(!(m.width>0&&m.height>0))errs.push(`model ${k}: width/height`);if(typeof m.costPerImage!=='number')errs.push(`model ${k}: costPerImage must be a number`)}
  for(const k of man.candidates||[])if(!(man.models||{})[k])errs.push(`candidates: unknown model ${k}`);
  if(!(man.candidates||[]).length)errs.push('candidates: list the models to try, best first');
  for(const t of TIERS){const c=man.tiers&&man.tiers[t];if(!c)errs.push(`tiers.${t}: generation settings missing`);else if(!(c.grid>0))errs.push(`tiers.${t}: grid must be a number`)}
  if(man.pinnedModel&&!(man.models||{})[man.pinnedModel])errs.push(`pinnedModel: unknown model ${man.pinnedModel}`);
  for(const e of man.assets){const m=ID.exec(e.id||'');
    if(!m){errs.push(`bad id ${e.id}`);continue}
    if(seen.has(e.id))errs.push(`duplicate id ${e.id}`);seen.add(e.id);
    if(!KINDS.includes(e.kind))errs.push(`${e.id}: unknown kind ${e.kind}`);else if(m[1]!==e.kind)errs.push(`${e.id}: kind ${e.kind} differs from the id prefix`);
    if(e.size!==undefined)errs.push(`${e.id}: 'size' is replaced by 'sizes' per tier`);
    for(const t of TIERS){const z=e.sizes&&e.sizes[t];if(!Array.isArray(z)||z.length!==2||!z.every(v=>Number.isInteger(v)&&v>0&&v<=512))errs.push(`${e.id}: sizes.${t} must be [w,h] 1..512`)}
    if(e.sizes)for(const t of Object.keys(e.sizes))if(!TIERS.includes(Number(t)))errs.push(`${e.id}: sizes.${t} is not a tier (${TIERS.join(', ')})`);
    if(e.kind==='sprite'&&e.sizes)for(const t of TIERS){const z=e.sizes[t],f=e.frames;if(!f||!(f.cols>0&&f.rows>0))errs.push(`${e.id}: a sprite sheet needs frames {cols, rows}`);
      else if(z&&(z[0]%f.cols||z[1]%f.rows))errs.push(`${e.id}: sizes.${t} does not split into ${f.cols}x${f.rows} frames`)}
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
// Keys are '<id>@<tier>'; each file is <kind>/<tier>/<name>.png at the manifest's size for that tier.
export function checkIndex(man,dir=ASSETS){
  const errs=[],idx=loadIndex(dir),byId=new Map(man.assets.map(e=>[e.id,e])),listed=new Set();
  for(const [key,a] of Object.entries(idx.assets)){
    const id=a.id||key.replace(/@.*$/,''),tier=a.tier,e=byId.get(id);if(!e){errs.push(`index: ${key} is not in the manifest`);continue}
    if(key!==tierKey(id,tier))errs.push(`index: key ${key}, expected ${tierKey(id,tier)}`);
    if(!TIERS.includes(tier)){errs.push(`index: ${key} tier ${tier} is not one of ${TIERS.join(', ')}`);continue}
    if(a.file!==fileOf(id,tier))errs.push(`index: ${key} file ${a.file}, expected ${fileOf(id,tier)}`);
    listed.add(a.file);const p=join(dir,a.file);
    if(!existsSync(p)){errs.push(`index: ${key} file ${a.file} is missing`);continue}
    const b=readFileSync(p),sz=pngSize(b),want=sizeOf(e,tier);
    if(!sz){errs.push(`${a.file}: not a PNG`);continue}
    if(!want||sz.w!==want[0]||sz.h!==want[1])errs.push(`${a.file}: ${sz.w}x${sz.h}, manifest says ${want?want.join('x'):'nothing'} at tier ${tier}`);
    if(a.w!==sz.w||a.h!==sz.h)errs.push(`index: ${key} size ${a.w}x${a.h} differs from the file ${sz.w}x${sz.h}`);
    if(a.sha256!==sha256(b))errs.push(`index: ${key} sha256 differs from ${a.file} (regenerate the index)`)}
  // stray PNGs nobody indexed (assets/<kind>/<tier>/*.png, or a <kind>/*.png from before tiers)
  const walk=(sub,rel)=>{for(const f of readdirSync(sub)){const p=join(sub,f),r=rel?`${rel}/${f}`:f;
    if(statSync(p).isDirectory()){if(r!=='incoming')walk(p,r)}else if(f.endsWith('.png')&&rel&&!listed.has(r))errs.push(`assets/${r} is not in assets/index.json`)}}; // incoming/<date>/ awaits review
  if(existsSync(dir))walk(dir,'');
  return {errs,count:Object.keys(idx.assets).length}}

// assets/queue.json: the daily run's local state (gitignored): the model that answered, what waits in
// assets/incoming/<date>/ for review, what failed and why, rejected redraws, alternates made, what is next.
export const QUEUE0=()=>({version:1,model:{pinned:null,tried:{}},incoming:{},failed:{},rejected:{},alts:{},next:[],lastRun:null});
// Keys are tier keys ('tile:grass@32', 'tile:grass@32#alt1'); a queue from before tiers is read as the 32 tier.
export function loadQueue(dir=ASSETS){const p=join(dir,'queue.json');if(!existsSync(p))return QUEUE0();
  const q={...QUEUE0(),...JSON.parse(readFileSync(p,'utf8'))};q.model={pinned:null,tried:{},...(q.model||{})};
  for(const f of ['incoming','failed','rejected','alts'])q[f]=Object.fromEntries(Object.entries(q[f]||{}).map(([k,v])=>[normKey(k),v]));
  q.next=(q.next||[]).map(k=>normKey(k));return q}
export function saveQueue(dir,q){mkdirSync(dir,{recursive:true});const p=join(dir,'queue.json');writeFileSync(p+'.tmp',JSON.stringify(q,null,1)+'\n');renameSync(p+'.tmp',p)}
// 'tile:grass@32#alt2' -> {id:'tile:grass', tier:32, alt:2} (no tier: LEGACY_TIER); the file of an alternate is
// <kind>/<tier>/<name>.alt2.png.
export function splitKey(k){const m=/^(.*?)(?:@(\d+))?(?:#alt(\d+))?$/.exec(k);return {id:m[1],tier:m[2]?Number(m[2]):LEGACY_TIER,alt:m[3]?Number(m[3]):0}}
export function keyFile(k){const {id,tier,alt}=splitKey(k);const f=fileOf(id,tier);return alt?f.replace(/\.png$/,`.alt${alt}.png`):f}

// When to look again after a run stopped (#661). kind: share (the day's share is spent: a new one opens at local
// midnight), provider (the provider refused: ART_RETRY_HOURS or its retry-after, whichever is later), month (the
// month's credits are spent: the 1st), complete (nothing left to make: tomorrow, or when the manifest changes), cap (a call cap, try
// again in a minute), anything else (error): ART_RETRY_HOURS.
export const WAIT_WHY={share:"day's share spent",provider:'the provider refused',month:"month's credits spent",complete:'nothing left to make',cap:'call cap reached',error:'a problem, see the stop reason'};
export function nextCheck(kind,now,{retryHours=4,retryAfter=0}={}){
  const t=now.getTime(),retry=t+retryHours*3600e3,mid=new Date(now.getFullYear(),now.getMonth(),now.getDate()+1).getTime();
  if(kind==='share')return new Date(Math.min(retry,mid));
  if(kind==='provider')return new Date(Math.max(retry,t+retryAfter*1000));
  if(kind==='month')return new Date(now.getFullYear(),now.getMonth()+1,1);
  if(kind==='complete')return new Date(mid);
  if(kind==='cap')return new Date(t+60e3);
  return new Date(retry)}
