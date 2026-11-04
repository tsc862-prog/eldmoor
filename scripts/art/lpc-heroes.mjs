// Hero sheets from the Universal LPC Spritesheet Character Generator's layers (#789 item 4).
//
//   node scripts/art/lpc-heroes.mjs [--out DIR] [--preview DIR] [--only Warrior,Mage] [--credits] [--index]
//
// Reads, as data only (nothing from the generator repo is ever run): its sheet_definitions/*.json (zPos, layer folders,
// variants, credits), its layer PNGs under assets/packs/lpc-generator/repo/spritesheets/ and CREDITS.csv. The choices
// (body, layers per class) are in scripts/art/lpc-heroes.json, deterministic: no dice. Each class is composed from its
// layers by zPos, the walk frames are cut at their own pixel scale (a 64x64 LPC frame holds a figure about 30x48, which is
// exactly our 32x48 frame, so nothing is downscaled), and the layers flagged `tint` (the tabard) are recoloured to the
// faction key ramp (palette.js SPRITE.key and its tier shades) so the per-faction recolour in sprites.js keeps working.
// Output: sprite sheets 96x192 (3 frames: stand and two steps; rows down, left, right, up) into DIR (default assets/sprite/32)
// as hero-<class>.png. `--index` also writes the index entries (source, licence, authors) into assets/index.json.
// Licence of the result: CC-BY-SA 3.0. Every layer used is offered under CC-BY-SA 3.0 or under OGA-BY 3.0 (attribution only, which a
// CC-BY-SA work may include); a layer offered under neither is refused. Credits per layer, with each layer's own licences.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {decodePng,encodePng} from './png.mjs';
import {FAC} from '../../src/data/factions.js';
import {TIER_SHADES,shadeHex} from '../../src/render/palette.js';
import {sha256,fileOf} from './lib.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','..');
const REPO=path.join(ROOT,'assets','packs','lpc-generator','repo');
const SHEETS=path.join(REPO,'spritesheets'),DEFS=path.join(REPO,'sheet_definitions');
export const CONFIG=path.join(ROOT,'scripts','art','lpc-heroes.json');
const LICENCE='CC-BY-SA 3.0';
const FS=64; // an LPC frame

const slug=s=>String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-');
const defCache=new Map();
const def=name=>{if(!defCache.has(name))defCache.set(name,JSON.parse(fs.readFileSync(path.join(DEFS,name+'.json'),'utf8')));return defCache.get(name)};

// CREDITS.csv (quoted fields): rows keyed by filename (a layer folder).
function csv(text){const rows=[];let row=[],f='',q=false;
  for(let i=0;i<text.length;i++){const c=text[i];
    if(q){if(c==='"'){if(text[i+1]==='"'){f+='"';i++}else q=false}else f+=c}
    else if(c==='"')q=true;else if(c===','){row.push(f);f=''}else if(c==='\n'){row.push(f);rows.push(row);row=[];f=''}else if(c!=='\r')f+=c}
  if(f||row.length){row.push(f);rows.push(row)}return rows}
let creditRows=null;
function creditsFor(file){
  if(!creditRows){const r=csv(fs.readFileSync(path.join(REPO,'CREDITS.csv'),'utf8')),h=r[0];
    creditRows=r.slice(1).filter(x=>x[0]).map(x=>({file:x[0],notes:x[1],authors:x[2],licenses:x[3],urls:x.slice(4,19).filter(Boolean)}))}
  // the longest row whose filename is the layer file or one of its folders
  let best=null;for(const c of creditRows){if(file===c.file||file.startsWith(c.file+'/')||file.startsWith(c.file+'.'))if(!best||c.file.length>best.file.length)best=c}
  return best}

// The layers (zPos, png, credit) a def contributes for a body type and variant; oversize attack layers are left out.
export function layersOf(defName,body,variant){
  const d=def(defName),out=[];
  for(const k of Object.keys(d).filter(k=>/^layer_\d+$/.test(k))){const L=d[k];if(L.custom_animation)continue;
    const dir=L[body];if(!dir)continue;
    const v=String(variant).replace(/ /g,'_'),rel=(dir.endsWith('/')?dir:dir+'/')+v;
    out.push({def:defName,rel,png:path.join(SHEETS,rel+'.png'),z:L.zPos})}
  return out}

function tintRamp(fac=0){const k=FAC[fac],f=TIER_SHADES[32].factors;void f;
  // lightest to darkest, every colour one the faction recolour maps (shadesOf(color) and shadesOf(dark), tier 32)
  return [shadeHex(k.color,1.3),shadeHex(k.color,1.15),k.color,shadeHex(k.color,.85),shadeHex(k.dark,1.15),k.dark]}
const lum=(r,g,b)=>.3*r+.59*g+.11*b;
const hexRgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));

// Recolour a layer's opaque colours into the key ramp by luminance rank (equal counts of distinct colours per step).
function tint(im){
  const cols=new Map();for(let i=0;i<im.w*im.h;i++){const o=i*4;if(im.data[o+3]<128)continue;const k=im.data[o]<<16|im.data[o+1]<<8|im.data[o+2];cols.set(k,lum(im.data[o],im.data[o+1],im.data[o+2]))}
  const order=[...cols.entries()].sort((a,b)=>b[1]-a[1]).map(e=>e[0]),ramp=tintRamp().map(hexRgb),map=new Map();
  order.forEach((k,i)=>map.set(k,ramp[Math.min(ramp.length-1,Math.floor(i*ramp.length/order.length))]));
  const d=new Uint8Array(im.data);
  for(let i=0;i<im.w*im.h;i++){const o=i*4;if(d[o+3]<128){d[o+3]=0;continue}const m=map.get(d[o]<<16|d[o+1]<<8|d[o+2]);d[o]=m[0];d[o+1]=m[1];d[o+2]=m[2];d[o+3]=255}
  return {w:im.w,h:im.h,data:d}}

// A layer is used only when it is offered under CC-BY-SA 3.0 (the sheets' licence), OGA-BY 3.0 (attribution only, which a CC-BY-SA
// work may include) or CC0; a layer offered under none of them is left out.
export const licenceOk=text=>/(^|[ ,])(CC-BY-SA 3.0|OGA-BY 3.0|CC0)([ ,+]|$)/.test(String(text||''));
const imgCache=new Map();
const load=p=>{if(!imgCache.has(p))imgCache.set(p,decodePng(fs.readFileSync(p)));return imgCache.get(p)};

// Compose a class: returns {layers:[{rel,z,im}], credits:[...]} (images are whole generator sheets, composited per frame later).
export function buildClass(cls,cfg){
  const body=cfg.body,skin=cfg.skin||'light',layers=[],credits=[];
  for(const L of cfg.layers){
    const d=def(L.def),variant=d.match_body_color?skin:L.variant;
    const ls=layersOf(L.def,body,variant);if(!ls.length)throw new Error(`${cls}: ${L.def} has no layer for body ${body}`);
    let used=0;
    for(const l of ls){if(!fs.existsSync(l.png)){if(l===ls[0])throw new Error(`${cls}: ${l.rel}.png is missing (add its folder to LPC_PATHS in packs.mjs)`);continue}
      const c=creditsFor(l.rel);if(!c)throw new Error(`${cls}: no credits for ${l.rel}; leaving it out`);
      if(!licenceOk(c.licenses))throw new Error(`${cls}: ${l.rel} is offered under none of CC-BY-SA 3.0, OGA-BY 3.0, CC0 (${c.licenses}); leaving it out`);
      layers.push({rel:l.rel,z:l.z,im:L.tint?tint(load(l.png)):load(l.png)});used++;
      if(!credits.find(x=>x.file===c.file))credits.push(c)}
    if(!used)throw new Error(`${cls}: ${L.def} gave no layer`)}
  layers.sort((a,b)=>a.z-b.z);return {layers,credits}}

// One 64x64 frame (row r, column c of the generator sheet) as RGBA.
function frame(layers,r,c){const d=new Uint8Array(FS*FS*4);
  for(const l of layers){const im=l.im;if((r+1)*FS>im.h||(c+1)*FS>im.w)continue;
    for(let y=0;y<FS;y++)for(let x=0;x<FS;x++){const o=((r*FS+y)*im.w+c*FS+x)*4,a=im.data[o+3];if(a<128)continue;const q=(y*FS+x)*4;d[q]=im.data[o];d[q+1]=im.data[o+1];d[q+2]=im.data[o+2];d[q+3]=255}}
  return d}

// The 96x192 sheet of a class.
export function sheetOf(built,cfgAll){
  const F=cfgAll.frames,[cx,cy]=F.crop,W=32*F.cols.length,H=48*F.rows.length,d=new Uint8Array(W*H*4);
  F.rows.forEach((r,ri)=>F.cols.forEach((c,ci)=>{const fr=frame(built.layers,r,c);
    for(let y=0;y<48;y++)for(let x=0;x<32;x++){const o=((cy+y)*FS+cx+x)*4;if(fr[o+3]<128)continue;const q=((ri*48+y)*W+ci*32+x)*4;d[q]=fr[o];d[q+1]=fr[o+1];d[q+2]=fr[o+2];d[q+3]=255}}));
  return {w:W,h:H,data:d}}

// Opaque bounding box over every frame used of a composed class (to set the crop).
export function boxOf(built,cfgAll){let x0=64,y0=64,x1=0,y1=0;
  for(const r of cfgAll.frames.rows)for(const c of cfgAll.frames.cols){const fr=frame(built.layers,r,c);
    for(let y=0;y<FS;y++)for(let x=0;x<FS;x++)if(fr[(y*FS+x)*4+3]){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y)}}
  return {x0,y0,x1,y1}}

export function creditLines(all){ // markdown, one bullet per layer folder, merged across classes
  const seen=new Map();for(const cs of all)for(const c of cs)if(!seen.has(c.file))seen.set(c.file,c);
  return [...seen.values()].sort((a,b)=>a.file.localeCompare(b.file)).map(c=>`- \`${c.file}\`: ${c.authors}. ${c.licenses}. ${c.urls.join(' ')}${c.notes?` (${c.notes})`:''}`)}

export function main(argv=process.argv.slice(2)){
  const o={};for(let i=0;i<argv.length;i++){if(argv[i]==='--out')o.out=argv[++i];else if(argv[i]==='--preview')o.preview=argv[++i];else if(argv[i]==='--only')o.only=argv[++i].split(',');else if(argv[i]==='--credits')o.credits=true;else if(argv[i]==='--index')o.index=true;else if(argv[i]==='--box')o.box=true;else if(argv[i]==='--credits-md')o.md=argv[++i]}
  const cfg=JSON.parse(fs.readFileSync(CONFIG,'utf8')),out=o.out||path.join(ROOT,'assets','sprite','32'),all=[],made=[];
  for(const [cls,c] of Object.entries(cfg.classes)){if(o.only&&!o.only.includes(cls))continue;
    const built=buildClass(cls,c);all.push(built.credits);
    if(o.box){console.log(cls,JSON.stringify(boxOf(built,cfg)));continue}
    const sh=sheetOf(built,cfg),buf=encodePng(sh),file=`hero-${slug(cls)}.png`;
    fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,file),buf);made.push({cls,file,sh,buf,credits:built.credits});console.log('[lpc]',cls,'->',path.join(out,file),`${sh.w}x${sh.h}`,`${built.layers.length} layers`)}
  if(o.preview){fs.mkdirSync(o.preview,{recursive:true})} // (previews are the sheets themselves, in --out)
  if(o.credits)console.log(creditLines(all).join('\n'));
  if(o.md&&made.length){const B='<!-- lpc-heroes:begin -->',E='<!-- lpc-heroes:end -->',t=fs.readFileSync(o.md,'utf8'),a=t.indexOf(B),z=t.indexOf(E);
    if(a<0||z<0)throw new Error('markers missing in '+o.md);fs.writeFileSync(o.md,t.slice(0,a+B.length)+'\n'+creditLines(all).join('\n')+'\n'+t.slice(z))}
  if(o.index&&made.length){const ip=path.join(ROOT,'assets','index.json'),idx=JSON.parse(fs.readFileSync(ip,'utf8'));
    for(const m of made){const id='sprite:hero-'+slug(m.cls),key=id+'@32';
      idx.assets[key]={id,kind:'sprite',file:fileOf(id,32),w:m.sh.w,h:m.sh.h,sha256:sha256(m.buf),tier:32,source:'lpc-generator',license:LICENCE,credits:'docs/CREDITS.md#lpc-hero-sheets',layers:m.credits.map(c=>c.file).sort(),accepted:new Date().toISOString().slice(0,10)}}
    idx.assets=Object.fromEntries(Object.keys(idx.assets).sort().map(k=>[k,idx.assets[k]]));fs.writeFileSync(ip,JSON.stringify(idx,null,2)+'\n')}
  return made}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
