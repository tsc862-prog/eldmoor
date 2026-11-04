// The building recipe of the art pipeline (#763): post-processing and the style gate for buildings and standing landmarks.
// The first accepted batch (2026-11-03) showed what goes wrong when a building is treated like a texture: a 1024 px
// painterly facade sampled down to 96x64 keeps a dozen close greys as one-pixel speckle, the outline is lost in them, and
// the subject floats. The procedural house beside it is 4-5 flat colours with a thick dark line, sitting on a darker strip.
// So an entry with post.flat goes this way instead of post-texture's:
//   1. the model's pixel grid is sampled (the image at its own pixel scale), the background cleared, the subject cropped;
//   2. the style gate's palette distance is read off that native subject (mean RGB distance of its pixels to the nearest
//      colour of the entry's flat palette, src/render/palette.js FLAT): the grey-noise case sits far from it;
//   3. the subject is scaled to fit the footprint above post.base rows (art px at the 32 tier, doubled at 64; the
//      renderer's base strip shows there), aspect kept, bottom centred, and posterised to exactly the palette (mode vote,
//      no widening with shades, no dither, no tone stretch);
//   4. the gate: more than maxColors colours (8), a speckle share (pixels with no 4-neighbour of their own colour) over
//      maxSpeckle, an edge share (4-neighbour pairs of different colours) over maxEdges, or the distance over maxDist is
//      refused as off-style (an error of kind 'flat', so daily/reprocess treat it like a flat output: rejected, raw kept);
//   5. one pass of despeckling (a lone pixel takes the colour three or four of its neighbours share), then the one-pixel
//      outline is re-drawn on the silhouette's rim in the palette's darkest colour (post.outlineColor wins).
// styleGate() is also what art:accept runs on the PNG under review (scripts/art/accept.mjs). Pure functions over
// {w, h, data: Uint8Array RGBA}; no I/O, no randomness.
import {hexToRgb,clearBackground,downscale} from './post.mjs';
import {detectGrid,sampleCells,nearestScale,quantise,colorCount} from './post-texture.mjs';

export const GATE={maxColors:8,maxSpeckle:.06,maxEdges:.3,maxDist:30};

const op=(im,i)=>im.data[i*4+3]>=128,key=(im,i)=>(im.data[i*4]<<16)|(im.data[i*4+1]<<8)|im.data[i*4+2];
// The opaque subject's bounding box as its own image, or null when nothing is opaque.
export function cropSubject(img){const {w,h,data}=img;let x0=w,y0=h,x1=-1,y1=-1;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(data[(y*w+x)*4+3]>=128){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y}
  if(x1<0)return null;const W=x1-x0+1,H=y1-y0+1,out=new Uint8Array(W*H*4);
  for(let y=0;y<H;y++)out.set(data.subarray(((y+y0)*w+x0)*4,((y+y0)*w+x0+W)*4),y*W*4);
  return {w:W,h:H,data:out}}
// Mean RGB distance of the opaque pixels to the nearest palette colour (0 = only palette colours; ~16 = a near miss).
export function paletteDistance(img,colors){const P=colors.map(hexToRgb),c=new Map();let s=0,n=0;
  for(let i=0;i<img.w*img.h;i++){if(!op(img,i))continue;const k=key(img,i);let d=c.get(k);
    if(d===undefined){const r=k>>16,g=(k>>8)&255,b=k&255;d=Infinity;for(const p of P)d=Math.min(d,Math.hypot(r-p[0],g-p[1],b-p[2]));c.set(k,d)}s+=d;n++}
  return n?s/n:0}
// Speckle: the share of opaque pixels with no 4-neighbour of their own colour. Edges: the share of opaque 4-neighbour
// pairs whose colours differ. A flat building has long runs (low both); a downscaled painting is mostly lone pixels.
export function texture(img){const {w,h}=img;let px=0,lone=0,pairs=0,diff=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;if(!op(img,i))continue;px++;const k=key(img,i);let same=false;
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const X=x+dx,Y=y+dy;if(X<0||Y<0||X>=w||Y>=h)continue;const j=Y*w+X;if(!op(img,j))continue;
      if(key(img,j)===k)same=true;if(dx>0||dy>0){pairs++;if(key(img,j)!==k)diff++}}
    if(!same)lone++}
  return {speckle:px?lone/px:0,edges:pairs?diff/pairs:0}}
// The gate on an image already at its asset size. dist: the distance to report (post: the native subject's; accept: the
// PNG's own). Returns {ok, colors, speckle, edges, dist, why: [reasons]}.
export function styleGate(img,colors,lim={},dist=paletteDistance(img,colors)){const L={...GATE,...lim},t=texture(img),n=colorCount(img),why=[];
  if(n>L.maxColors)why.push(`${n} colours (at most ${L.maxColors})`);
  if(t.speckle>L.maxSpeckle)why.push(`speckled: ${Math.round(t.speckle*100)}% lone pixels (at most ${Math.round(L.maxSpeckle*100)}%)`);
  if(t.edges>L.maxEdges)why.push(`noisy edges: ${Math.round(t.edges*100)}% of neighbours differ (at most ${Math.round(L.maxEdges*100)}%)`);
  if(dist>L.maxDist)why.push(`off-palette: mean distance ${dist.toFixed(1)} from the flat palette (at most ${L.maxDist})`);
  const r=x=>Math.round(x*1000)/1000;return {ok:!why.length,colors:n,speckle:r(t.speckle),edges:r(t.edges),dist:r(dist),why}}
// The gate limits of a manifest entry: GATE, overridden by its post.gate.
export const gateOf=e=>({...GATE,...((e&&e.post&&e.post.gate)||{})});

export class OffStyleError extends Error{constructor(g,notes){super(`off-style: ${g.why.join('; ')}`);this.kind='flat';this.why='off-style';this.gate=g;this.notes=notes}}

// A lone pixel whose neighbours (3 or 4 of them) agree on one colour takes it. One pass, read from the input.
export function despeckle(img){const {w,h,data}=img,out=new Uint8Array(data);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;if(!op(img,i))continue;const k=key(img,i),votes=new Map();let same=false;
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const X=x+dx,Y=y+dy;if(X<0||Y<0||X>=w||Y>=h||!op(img,Y*w+X))continue;const kj=key(img,Y*w+X);if(kj===k)same=true;else votes.set(kj,(votes.get(kj)||0)+1)}
    if(same)continue;for(const [kj,v] of votes)if(v>=3){out[i*4]=kj>>16;out[i*4+1]=(kj>>8)&255;out[i*4+2]=kj&255;break}}
  return {w,h,data:out}}
// The one-pixel outline on the silhouette's own rim: every opaque pixel touching a clear one (or the image edge) takes it.
export function rimOutline(img,color){const {w,h,data}=img,out=new Uint8Array(data),c=hexToRgb(color);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;if(!op(img,i))continue;
    const rim=[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>{const X=x+dx,Y=y+dy;return X<0||Y<0||X>=w||Y>=h||!op(img,Y*w+X)});
    if(rim){out[i*4]=c[0];out[i*4+1]=c[1];out[i*4+2]=c[2];out[i*4+3]=255}}
  return {w,h,data:out}}
const darkest=cols=>cols.slice().sort((a,b)=>{const l=c=>{const [r,g,bb]=hexToRgb(c);return r*.299+g*.587+bb*.114};return l(a)-l(b)})[0];

// The whole recipe for one entry (called by post-texture.mjs postProcess when entry.post.flat). Returns {w, h, data,
// notes} or throws OffStyleError (kind 'flat').
export function postFlat(img,entry,pal,{hint=8,tier=32}={}){
  const p=entry.post||{},[W,H]=(entry.sizes&&entry.sizes[tier])||entry.size,g=detectGrid(img,p.grid||hint);
  // flat colour areas carry few block edges, so the grid search can lock onto a multiple: keep it near the hint
  for(const a of ['x','y'])if(!p.grid&&!(g[a].s>=hint/1.5&&g[a].s<=hint*1.5)){g[a]={s:hint,o:0,score:0};g.found=false}
  const notes={grid:g.found?`${g.x.s}x${g.y.s}`:`none (used ${g.x.s})`,recipe:'flat'};
  const native=clearBackground(sampleCells(img,g),p.bgTolerance??40),sub=cropSubject(native);notes.native=`${native.w}x${native.h}`;
  if(!sub)throw new OffStyleError({why:['nothing left after the background was cleared']},notes);
  const dist=paletteDistance(sub,pal),base=Math.round((p.base||0)*tier/32),H2=H-base,k=Math.min(W/sub.w,H2/sub.h);
  let im;if(k<1)im=downscale(sub,Math.max(1,Math.round(sub.w*k)),Math.max(1,Math.round(sub.h*k)),pal,'mode');
  else im=quantise(nearestScale(sub,Math.max(1,Math.floor(k))),pal);
  const out={w:W,h:H,data:new Uint8Array(W*H*4)},ox=Math.floor((W-im.w)/2),oy=Math.max(0,H2-im.h);
  for(let y=0;y<im.h&&y+oy<H;y++)for(let x=0;x<im.w&&x+ox<W;x++){const s=(y*im.w+x)*4,o=((y+oy)*W+x+ox)*4;for(let c=0;c<4;c++)out.data[o+c]=im.data[s+c]}
  notes.subject=`${sub.w}x${sub.h} -> ${im.w}x${im.h}`;notes.base=base;
  return finishFlat(out,entry,pal,dist,notes)}
// The gate and the finish, for an image already on the footprint (post-init.mjs comes here too): steps 4 and 5.
export function finishFlat(out,entry,pal,dist,notes){const p=entry.post||{};
  const gate=styleGate(out,pal,gateOf(entry),dist);notes.gate=gate;
  if(!gate.ok)throw new OffStyleError(gate,notes);
  const fin=rimOutline(despeckle(out),p.outlineColor||darkest(pal));notes.colors=colorCount(fin);
  return {w:out.w,h:out.h,data:fin.data,notes}}
