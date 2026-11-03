// Generated image assets (#177): the PNGs under assets/ made by scripts/art/gen.mjs, listed in
// assets/index.json. Every asset is optional: asset(id) answers the image once it has loaded and null
// before that, when it is missing or failed, or with no DOM (Node); each renderer then draws its
// procedural version. Nothing here touches the sim, the map or its hash.
//
// The host hands the index over (main.js reads assets/index.json and the PNG URLs through Vite's
// import.meta.glob, so an absent folder is simply an empty index): provideAssets(index, urls).
// PNGs load lazily, the first time a renderer asks for one; onAssets(fn) tells a renderer that an asset
// arrived (terrain.js repaints its cached chunks).

let INDEX={},URLS={};
const imgs=new Map(),pix=new Map(),subs=new Set();

// index: the parsed assets/index.json ({assets: {id: {file, w, h, ...}}}) or null; urls: {file: url}.
export function provideAssets(index,urls){
  INDEX=(index&&index.assets)||{};URLS=urls||{};imgs.clear();pix.clear();
  for(const f of subs)f(null)}

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
export function setAssetPixels(id,p){if(p){pix.set(id,p);INDEX[id]=INDEX[id]||{file:'(memory)'};imgs.set(id,{ok:false,dead:true})}else{pix.delete(id);imgs.delete(id);delete INDEX[id]}fire(id)}
