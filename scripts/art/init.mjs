// The init image of the art pipeline (#763, owner decision 2026-11-03): buildings, landmarks and sprites are made image to
// image from the game's own art. pixel-xl ignores layout prompts (4 of 96 passed the first batch, and those stood wrong in a
// town), so here the view, the silhouette, the footprint, the frame grid and the palette are ours, and the model, at a low
// strength, adds texture and character only.
//   initArt(e, tier, ...)   the procedural art at the asset's size: town pieces and landmarks through src/render/pieceart.js
//                           (world units, nearest-scaled to the tier), sprites from the pixel strings of src/render/sprites.js
//                           laid out as sheetFrame reads them (3 frames: stand, step, other step; 4 rows: down, left, right, up);
//                           quantised to the entry's palette, outlined, the post.base rows left clear for the renderer's strip.
//   initLayout(w, h, cw, ch) where that image sits in the model's working canvas: one integer scale, centred.
//   makeInit(...)           the init of one job: {small (the art), k, ox, oy, cw, ch, strength, b64 (the canvas as PNG, nearest
//                           neighbour on white, what the Space receives)}. post-init.mjs reads the model's answer back through
//                           the same layout, so a pixel of the asset is exactly one k x k cell of the model's image.
// DOM-free and deterministic; no network. Node only.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {decodePng,encodePng} from './png.mjs';
import {hexToRgb,resolvePalette} from './post.mjs';
import {quantise,nearestScale,expandPalette} from './post-texture.mjs';
import {rimOutline} from './post-flat.mjs';
import {tierCfg,keyFile,U} from './lib.mjs';
import {drawHouse,drawCryptMouth,sketchPiece} from '../../src/render/pieceart.js';
import {SPR,heroArt,ASSET_SPRITES} from '../../src/render/sprites.js';
import {MOBS} from '../../src/data/mobs.js';
import {FAC} from '../../src/data/factions.js';

export const BACKGROUND=[255,255,255]; // the canvas round the art; post-init.mjs measures what the model spilled onto it
const canvas=(w,h)=>({w,h,data:new Uint8Array(w*h*4)});

// #rgba / #rrggbb colours onto an RGBA image, with source-over for the short form's alpha (the game's '#fff3' highlights).
function raster(im){const parse=c=>{const s=c.slice(1);if(s.length===4){const [r,g,b,a]=[...s].map(v=>parseInt(v+v,16));return [r,g,b,a/255]}return [...hexToRgb(c),1]};
  return (x,y,w,h,c)=>{const [r,g,b,a]=parse(c);
    for(let Y=Math.max(0,y);Y<Math.min(im.h,y+h);Y++)for(let X=Math.max(0,x);X<Math.min(im.w,x+w);X++){const o=(Y*im.w+X)*4;
      if(a===1||!im.data[o+3]){im.data[o]=r;im.data[o+1]=g;im.data[o+2]=b;im.data[o+3]=a===1?255:Math.round(a*255);continue}
      for(const [i,v] of [[0,r],[1,g],[2,b]])im.data[o+i]=Math.round(im.data[o+i]*(1-a)+v*a)}}}

// building:<style>-<piece> and landmark:<name> as drawing in world units; null for an id with no procedural art.
function pieceUnits(e,tier,PAL){const [W,H]=e.sizes[tier],s=tier/U,im=canvas(W/s,H/s),R=raster(im),name=e.id.split(':')[1];
  if(e.kind==='landmark'){const c=PAL.FLAT[name.split('-')[0]];if(!c)return null;
    if(name==='crypt-mouth')drawCryptMouth(R,0,0);else if(!sketchPiece(R,name,c))return null;return im}
  const m=/^([a-z]+)-(.+)$/.exec(name),st=m&&PAL.FLAT[m[1]];if(!st)return null;const c={...st,stone:PAL.TOWN[m[1]].stone},piece=m[2];
  if(piece==='auction')drawHouse(R,0,0,c.roof[1],c.wall[0],c.door);
  else if(piece==='hall')drawHouse(R,0,0,c.roof[2],c.wall[0]);
  else if(!sketchPiece(R,piece,c))return null;
  return im}

// One figure's pixel rows turned to a direction. Heroes are drawn from the front: side and back views are the same body with
// the face moved round. Only columns 1-6 change, so the weapon stays where WEAPON put it. Left is the right view mirrored.
const put=(rows,y,s)=>{rows[y]=rows[y].slice(0,1)+s+rows[y].slice(7)};
const mirror=rows=>rows.map(r=>[...r.padEnd(Math.max(...rows.map(v=>v.length)),'.')].reverse().join(''));
function heroTurn(src,dir){const r=[...src];
  if(dir==='right'||dir==='left'){put(r,2,'RRSSSS');put(r,3,'RSSSES');put(r,4,'.RSSS.');put(r,7,'DBBBAD');return dir==='left'?mirror(r):r}
  if(dir==='up'){put(r,2,'RHHHHR');put(r,3,'RHHHHR');put(r,4,'.HHHH.');put(r,7,'DBBBBD')}
  return r}
// [{rows, map}] per frame, row by row (directions) and stand, step, other step.
function sheetFrames(e,dirs=['down','left','right','up']){const A=ASSET_SPRITES[e.id];if(!A)return null;const out=[];
  if(A.kind==='hero'){const a={fac:0,cls:A.cls,skin:FAC[0].skin[0],hair:'#2a2020'},f0=heroArt(a,false,0),f1=heroArt(a,false,1),other=[...f0.rows.slice(0,10),...f1.rows.slice(10)]; // the other step: legs out, arm down
    for(const d of dirs)for(const rows of [f0.rows,f1.rows,other])out.push({rows:heroTurn(rows,d),map:f0.map});return out}
  const M=MOBS[A.type],fr=M&&SPR[M.spr];if(!fr)return null; // creatures are drawn side on, head right; the game flips them, so there is no front or back view
  for(const d of dirs)for(const rows of [fr[0],fr[1],fr[1]])out.push({rows:d==='left'||d==='up'?mirror(rows):rows,map:M.col});return out}
// Scales of a figure in its frame: the largest whole numbers, kept equal unless a third taller keeps a slim hero its full height.
function fit(w,h,fw,fh){const kx=Math.floor(fw/w),ky=Math.floor(fh/h),k=Math.min(kx,ky);return k>=1&&Math.max(kx,ky)/k<=4/3?[kx,ky]:[k,k]}
function sheetImage(e,tier){const [W,H]=e.sizes[tier],{cols,rows}=e.frames,fw=W/cols,fh=H/rows,fr=sheetFrames(e);if(!fr)return null;
  const im=canvas(W,H);
  fr.forEach(({rows:px,map},i)=>{const w=Math.max(...px.map(r=>r.length)),h=px.length,[kx,ky]=fit(w,h,fw,fh),X0=(i%cols)*fw+Math.floor((fw-w*kx)/2),Y0=Math.floor(i/cols)*fh+fh-h*ky;
    px.forEach((r,y)=>[...r].forEach((ch,x)=>{const c=ch!=='.'&&map[ch];if(!c)return;const [R,G,B]=hexToRgb(c);
      for(let b=0;b<ky;b++)for(let a=0;a<kx;a++){const o=((Y0+y*ky+b)*W+X0+x*kx+a)*4;im.data[o]=R;im.data[o+1]=G;im.data[o+2]=B;im.data[o+3]=255}}))});
  return im}

// The colours an entry's output may use: exactly the flat palette on the building recipe, else the palette widened for the tier.
export function entryColors(e,PAL,tier,m,man){const pal=resolvePalette(e.palette,PAL).colors;if(e.post&&e.post.flat)return pal;
  const cfg=tierCfg(man,m,tier),sh=(PAL.TIER_SHADES&&PAL.TIER_SHADES[tier])||{};return expandPalette(pal,(e.post&&e.post.minPalette)??cfg.minPalette??sh.minPalette??6,sh.factors)}
const darkest=cols=>cols.map(c=>[c,hexToRgb(c)]).sort((a,b)=>a[1][0]*.299+a[1][1]*.587+a[1][2]*.114-(b[1][0]*.299+b[1][1]*.587+b[1][2]*.114))[0][0];

// A rim outline inside each cell of a cols x rows grid, so a figure that fills its frame keeps its line and none crosses into the next.
export function rimFrames(im,cols,rows,color){const fw=im.w/cols,fh=im.h/rows,out=new Uint8Array(im.data);
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){const f=canvas(fw,fh);
    for(let y=0;y<fh;y++)f.data.set(im.data.subarray(((r*fh+y)*im.w+c*fw)*4,((r*fh+y)*im.w+(c+1)*fw)*4),y*fw*4);
    const o=rimOutline(f,color);for(let y=0;y<fh;y++)out.set(o.data.subarray(y*fw*4,(y+1)*fw*4),((r*fh+y)*im.w+c*fw)*4)}
  return {w:im.w,h:im.h,data:out}}

// The procedural art of an entry at the asset's size, or null when it has none.
export function initArt(e,tier,PAL,m,man){const colors=entryColors(e,PAL,tier,m,man),line=(e.post&&e.post.outlineColor)||(e.post&&e.post.flat?darkest(colors):PAL.MARK.outline);
  if(e.frames){const im=sheetImage(e,tier);return im&&rimFrames(quantise(im,colors),e.frames.cols,e.frames.rows,line)}
  const un=pieceUnits(e,tier,PAL);if(!un)return null;
  const im=quantise(nearestScale(un,tier/U),colors),base=Math.round(((e.post&&e.post.base)||0)*tier/32);
  for(let y=im.h-base;y<im.h;y++)im.data.fill(0,y*im.w*4,(y+1)*im.w*4);
  return e.post&&e.post.flat?rimOutline(im,line):im}

// The largest whole scale of a w x h image in a cw x ch canvas, centred.
export function initLayout(w,h,cw,ch){const k=Math.floor(Math.min(cw/w,ch/h));return {k,ox:Math.floor((cw-w*k)/2),oy:Math.floor((ch-h*k)/2),cw,ch}}
// The art on the model's canvas: nearest neighbour, on BACKGROUND, no alpha.
export function initCanvas(small,{k,ox,oy,cw,ch}){const out=canvas(cw,ch);
  for(let i=0;i<cw*ch;i++){out.data[i*4]=BACKGROUND[0];out.data[i*4+1]=BACKGROUND[1];out.data[i*4+2]=BACKGROUND[2];out.data[i*4+3]=255}
  for(let y=0;y<small.h*k;y++)for(let x=0;x<small.w*k;x++){const s=(Math.floor(y/k)*small.w+Math.floor(x/k))*4;if(small.data[s+3]<128)continue;
    const o=((y+oy)*cw+x+ox)*4;out.data[o]=small.data[s];out.data[o+1]=small.data[s+1];out.data[o+2]=small.data[s+2]}
  return out}

// The init of one job at a tier for a model. null when the entry is not made from an init image; an entry that is, with no
// procedural art, throws.
export function makeInit(e,tier,m,PAL,man){if(!e.init)return null;const small=initArt(e,tier,PAL,m,man);
  if(!small)throw new Error(`${e.id}: no procedural art to start from (scripts/art/init.mjs)`);
  const L=initLayout(small.w,small.h,m.width,m.height);if(L.k<1)throw new Error(`${e.id}: ${small.w}x${small.h} does not fit the model's ${m.width}x${m.height}`);
  return {small,...L,strength:e.strength,b64:encodePng(initCanvas(small,L)).toString('base64')}}

// Kept beside the raw image (<name>.init.png: the art at asset size), so art:reprocess reads the very layout and silhouette the
// model was given, whatever the procedural art has become since. The meta goes into raw/index.json.
export function saveInit(inc,key,init){const file=keyFile(key).replace(/\.png$/,'.init.png'),p=join(inc,'raw',file);
  mkdirSync(dirname(p),{recursive:true});writeFileSync(p,encodePng(init.small));
  const {k,ox,oy,cw,ch,strength}=init;return {file,k,ox,oy,cw,ch,strength}}
export function loadInit(inc,meta){return {...meta,small:decodePng(readFileSync(join(inc,'raw',meta.file)))}}
