// Generated image assets (#177): the PNGs under assets/ made by scripts/art/gen.mjs, listed in
// assets/index.json. Every asset is optional: asset(id) answers the image once it has loaded and null
// before that, when it is missing or failed, or with no DOM (Node); each renderer then draws its
// procedural version. Nothing here touches the sim, the map or its hash.
//
// The host hands the index over (main.js reads assets/index.json and the PNG URLs through Vite's
// import.meta.glob, so an absent folder is simply an empty index): provideAssets(index, urls).
// PNGs load lazily, the first time a renderer asks for one; onAssets(fn) tells a renderer that an asset
// arrived (terrain.js repaints its cached chunks).

//
// Tiers (#177, render/tile.js): every index entry carries the tier it was made for (`tier: 32` or 64; key `<id>@<tier>`,
// file `<kind>/<tier>/<name>.png`). Only the entries of the renderer's tier (TILE) are used; an id with no entry of that
// tier is absent, so its renderer draws the procedural version scaled to TILE. An entry without a tier (made before
// tiers) counts as the 32 tier.
import {TILE} from './tile.js';

let INDEX={},URLS={};
const imgs=new Map(),pix=new Map(),subs=new Set(),portC=new Map(); // portC: portraitAssets lists, cleared when the index changes

export const LEGACY_TIER=32;
// The tier of an index entry (key 'tile:grass@32' or the entry's own tier; none: LEGACY_TIER).
export function tierOf(key,a){if(a&&Number.isInteger(a.tier))return a.tier;const m=/@(\d+)$/.exec(key||'');return m?Number(m[1]):LEGACY_TIER}
// The entries of one tier from an index's assets, keyed by asset id.
export function entriesFor(assets,tier=TILE){const out={};
  for(const [k,a] of Object.entries(assets||{})){if(tierOf(k,a)!==tier)continue;const id=(a&&a.id)||k.replace(/@\d+$/,'');out[id]={...a,id,tier}}
  return out}

// index: the parsed assets/index.json ({assets: {key: {id, tier, file, w, h, ...}}}) or null; urls: {file: url}.
export function provideAssets(index,urls,tier=TILE){
  INDEX=entriesFor(index&&index.assets,tier);URLS=urls||{};imgs.clear();pix.clear();portC.clear();
  for(const f of subs)f(null)}
// The tier the loaded index was filtered to, and an asset's index entry (null when absent at that tier).
export const assetTier=()=>TILE;
export const assetEntry=id=>INDEX[id]||null;

export function onAssets(fn){subs.add(fn);return ()=>subs.delete(fn)}
const fire=id=>{for(const f of subs){try{f(id)}catch(e){console.warn('[assets]',e)}}};

export const hasAsset=id=>!!INDEX[id];
export const assetIds=()=>Object.keys(INDEX);

// The loaded image for id, or null (and starts loading it on first ask).
export function asset(id){
  let s=imgs.get(id);if(s)return s.ok?s.img:null;
  const a=INDEX[id],url=a&&URLS[a.file];
  if(!url||typeof Image==='undefined'){imgs.set(id,{ok:false,dead:true});return null}
  const img=new Image();s={img,ok:false};imgs.set(id,s);
  img.onload=()=>{s.ok=true;pix.delete(id);fire(id)};
  img.onerror=()=>{s.dead=true;console.warn(`[assets] ${a.file} failed to load; drawing ${id} procedurally`)};
  img.src=url;return null}

// The asset as pixels for per-texel renderers: {w, h, hex: Array of '#rrggbb' or null (transparent)}, or null.
export function assetPixels(id){
  if(pix.has(id))return pix.get(id);
  const img=asset(id);if(!img||typeof document==='undefined')return null;
  let p=null;try{const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const x=c.getContext('2d');x.drawImage(img,0,0);
    p=pixelsOf(c.width,c.height,x.getImageData(0,0,c.width,c.height).data)}catch(e){console.warn('[assets]',id,e)}
  pix.set(id,p);return p}

export function pixelsOf(w,h,data){const hex=new Array(w*h);
  for(let i=0;i<w*h;i++){const o=i*4;hex[i]=data[o+3]<128?null:'#'+((1<<24)|(data[o]<<16)|(data[o+1]<<8)|data[o+2]).toString(16).slice(1)}
  return {w,h,hex}}

// For tools and checks without a DOM: install decoded pixels for id directly (null removes them).
export function setAssetPixels(id,p){portC.clear();if(p){pix.set(id,p);INDEX[id]=INDEX[id]||{file:'(memory)'};imgs.set(id,{ok:false,dead:true})}else{pix.delete(id);imgs.delete(id);delete INDEX[id]}fire(id)}

// The portrait library (#710, epic #177): faces made offline, ids portrait:<race>-<cls>-<sex>-<nn> for heroes (class as its
// lower-case slug, sex one letter) and portrait:townsfolk-<role>-<nn> for townsfolk. The library may be partial; nothing
// here picks a face (render/portrait.js does). parsePortraitId(id) -> {race, cls, sex, nn} or null.
export function parsePortraitId(id){const m=/^portrait:([a-z0-9]+)-([a-z0-9-]+?)-(\d+)$/i.exec(id||'');if(!m)return null;
  const mid=m[2].toLowerCase().split('-');let sex='';if(mid.length>1&&/^[a-z]$/.test(mid[mid.length-1]))sex=mid.pop();
  return {race:m[1].toLowerCase(),cls:mid.join('-'),sex,nn:Number(m[3])}}
const slugOf=s=>String(s==null?'':s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
// The portrait ids in the loaded index for one people and class (cls omitted: every class of that people), sorted so the
// pick never depends on the index order. portraitAssets('townsfolk', role) lists the townsfolk faces of a role.
export function portraitAssets(race,cls){const r=slugOf(race),c=cls==null||cls===''?null:slugOf(cls),k=r+'|'+(c==null?'*':c);
  let l=portC.get(k);if(l)return l;
  l=Object.keys(INDEX).filter(id=>{const p=parsePortraitId(id);return p&&p.race===r&&(c==null||p.cls===c)}).sort();
  portC.set(k,l);return l}
