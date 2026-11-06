// Mountains from the LPC cliff set (#895): one atlas of dual-grid pieces per rock colour, cut from tiles/mountains.png of the LPC
// base assets (Lanea Zimmerman (Sharm), CC-BY-SA 3.0; assets/packs/lpc-base, gitignored, `npm run art:packs`). Nothing is scaled.
//
// The sheet's plateau (tile columns 5-7, rows 0-4) is already a dual grid: its left and right columns have the cliff's side down the
// middle of the tile and row 0 the rim, so an LPC tile is a piece centred on a tile corner. Row 0 is the north rim, row 1 the top
// surface, row 2 the lip where the top drops into the face, row 3 the face, row 4 the foot.
//
// An atlas (src/render/peaks.js reads it) is 16 columns, one per corner mask (bit 0 top left, 1 top right, 2 bottom left, 3 bottom
// right: the tiles round the corner that belong to the shape), in two rows: the massif (the face, drawn for every mountain tile)
// and the cap (the top surface, drawn for the mountain tiles with another below them, over the massif). Inner corners and
// diagonals have no tile in the sheet: they are the union of two pieces. The massif's north edge is the rim above the lip, so a
// ridge one tile deep still has a top. Colours are the sheet's with hue, saturation and lightness moved (tint in packcut-biomes).
//
//   node scripts/art/packcut-peaks.mjs [--out DIR] [--index]
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {encodePng} from './png.mjs';
import {sha256,fileOf} from './lib.mjs';
import {T,px,put,blank,over,tile,sheet,LPC_BASE} from './packcut.mjs';
import {tint,grounds,PLAIN,TERRAINS} from './packcut-biomes.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','..');
const LEFT=5,MID=6,RIGHT=7; // the sheet's tile columns of the plateau
const RIM=22,LIP=4;         // massif north edge: rows 0..RIM-1 of the sheet's row 0, then row 2 from LIP
// Rows of two tiles stacked into one: the rim, then the lip and the first of the face.
function rim(S,c){const o=blank(T,T),a=tile(S,c,0),b=tile(S,c,2);
  for(let y=0;y<T;y++)for(let x=0;x<T;x++)put(o,x,y,y<RIM?px(a,x,y):px(b,x,LIP+y-RIM));return o}
const union=(...ps)=>{const o=blank(T,T);for(const p of ps)over(o,p,0,0);return o};
export function layers(S){
  const t=(c,r)=>tile(S,c,r),cap=[],mass=[];
  cap[15]=t(MID,1);cap[12]=t(MID,0);cap[3]=t(MID,2);cap[10]=t(LEFT,1);cap[5]=t(RIGHT,1);cap[8]=t(LEFT,0);cap[4]=t(RIGHT,0);cap[2]=t(LEFT,2);cap[1]=t(RIGHT,2);
  mass[15]=t(MID,3);mass[12]=rim(S,MID);mass[3]=t(MID,4);mass[10]=t(LEFT,3);mass[5]=t(RIGHT,3);mass[8]=rim(S,LEFT);mass[4]=rim(S,RIGHT);mass[2]=t(LEFT,4);mass[1]=t(RIGHT,4);
  for(const L of [cap,mass]){L[14]=union(L[12],L[10]);L[13]=union(L[12],L[5]);L[11]=union(L[3],L[10]);L[7]=union(L[3],L[5]);L[6]=union(L[2],L[4]);L[9]=union(L[1],L[8])}
  return {mass,cap}}
// The sheet's top surface is sand, its face brown: a pixel lighter than this is the top (or its lit rim), the rest the face.
const isTop=p=>(Math.max(p[0],p[1],p[2])+Math.min(p[0],p[1],p[2]))/510>.44;
function recolour(im,top,face){const a=blank(im.w,im.h),b=blank(im.w,im.h),o=blank(im.w,im.h);
  for(let y=0;y<im.h;y++)for(let x=0;x<im.w;x++){const p=px(im,x,y);if(p[3]<1)continue;put(isTop(p)?a:b,x,y,p)}
  const A=tint(a,...top),B=tint(b,...face);
  for(let y=0;y<im.h;y++)for(let x=0;x<im.w;x++){const p=px(A,x,y),q=px(B,x,y);if(p[3])put(o,x,y,p);else if(q[3])put(o,x,y,q)}
  return o}
// A top of snow: the LPC snow ground (the atlas's Snow block) in place of the sheet's cobbles, the lit rim kept as drift.
function snowTop(im,snow){const o=blank(im.w,im.h);
  for(let y=0;y<im.h;y++)for(let x=0;x<im.w;x++){const p=px(im,x,y);if(p[3]<1)continue;const q=px(snow,x%T,y%T);put(o,x,y,isTop(p)?[q[0]*.9,q[1]*.94,q[2],255]:p)}
  return o}
// Peaks to stand on a massif: the sheet has no peak, so one is cut from its cliff face: the face tile's pixels inside a jagged silhouette, lit
// on the left of a wandering ridge and shaded on the right (the light is top left everywhere), with the sheet's dark edge colour as the
// outline and, where a set says so, a snow cap of the LPC snow ground. Deterministic: the shape is an integer hash of the column or row.
const hh=(a,b)=>{let h=Math.imul(a+1,374761393)^Math.imul(b+7,668265263);h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967296};
const smooth=(n,s,k)=>{const i=Math.floor(n/k),f=n/k-i,u=f*f*(3-2*f);return hh(i,s)*(1-u)+hh(i+1,s)*u};
const mul=(p,k)=>[Math.min(255,p[0]*k),Math.min(255,p[1]*k),Math.min(255,p[2]*k),255];
export function peak(face,snow,w,h,seed,capShare){const o=blank(w,h),inside=(x,y)=>{
    const t=(y+1)/h,cx=w/2+(smooth(y,seed,9)-.5)*w*.5*t*(1-t),jl=(smooth(y,seed+1,5)-.5)*7*Math.min(1,t*3),jr=(smooth(y,seed+2,5)-.5)*7*Math.min(1,t*3),hw=(w/2-2)*Math.pow(t,.9);
    return x>=cx-hw+jl&&x<=cx+hw+jr&&y<h-1-smooth(x,seed+3,4)*4};
  const edge=[42,28,30,255];
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){if(!inside(x,y))continue;
    if(!inside(x-1,y)||!inside(x+1,y)||!inside(x,y-1)||!inside(x,y+1)){put(o,x,y,edge);continue}
    const t=(y+1)/h,ridge=w/2+(smooth(y,seed,9)-.5)*w*.5*t*(1-t)+(smooth(y,seed+4,7)-.5)*w*.22*t,lit=x<ridge,side=lit?1.3-.25*t:.72+.08*(1-t),cl=capShare+(smooth(x,seed+5,5)-.5)*.14+Math.abs(x-ridge)/w*.2;
    if(capShare&&t<cl){const q=px(snow,x%T,y%T);put(o,x,y,lit?q:[q[0]*.7,q[1]*.76,q[2]*.92,255]);continue}
    const fold=Math.abs(x-ridge)<1.2?.8:1;put(o,x,y,mul(px(face,x%T,y%T),side*fold))}
  return o}
export const BIG=[96,84],SMALL=[64,54],VARIANTS=3;
// Rock colours: [hue shift, saturation x, lightness x] for the top and the face; caps: the snowy share of a big and a small peak.
export const PEAK_SETS={
  stone:{top:[12,.3,.86],face:[6,.45,.92],caps:[.3,0]},
  ash:{top:[-22,.16,.58],face:[-10,.5,.7],caps:[0,0]},
  snow:{top:[175,.3,1.62],face:[195,.28,1],snow:true,caps:[.5,.5]}};
export function atlas(S,set,snow){const {mass,cap}=layers(S),o=blank(T*16,T*2+BIG[1]);
  mass.forEach((p,m)=>over(o,p,m*T,0));cap.forEach((p,m)=>over(o,p,m*T,T));
  const c=recolour(set.snow?snowTop(o,snow):o,set.snow?[0,1,1]:set.top,set.face),face=tint(tile(S,MID,3),...set.face);
  for(let i=0;i<VARIANTS;i++){const big=peak(face,snow,BIG[0],BIG[1],11+i*17,set.caps[0]),sm=peak(face,snow,SMALL[0],SMALL[1],67+i*13,set.caps[1]);
    copy(c,big,i*BIG[0],T*2);copy(c,sm,VARIANTS*BIG[0]+i*SMALL[0],T*2)}
  return c}
const copy=(d,s,ox,oy)=>{for(let y=0;y<s.h;y++)for(let x=0;x<s.w;x++){const p=px(s,x,y);if(p[3])put(d,x+ox,y+oy,p)}};
export const cutPeaks=()=>{const S=sheet('mountains'),snow=grounds().snow.plain[PLAIN.snow];return Object.fromEntries(Object.entries(PEAK_SETS).map(([k,s])=>['autotile:peak-'+k,atlas(S,s,snow)]))};

function main(argv=process.argv.slice(2)){
  const o={};for(let i=0;i<argv.length;i++){if(argv[i]==='--out')o.out=argv[++i];else if(argv[i]==='--index')o.index=true}
  const out=o.out||path.join(ROOT,'assets'),ip=path.join(ROOT,'assets','index.json'),idx=o.index?JSON.parse(fs.readFileSync(ip,'utf8')):null;
  for(const [id,im] of Object.entries(cutPeaks())){const file=fileOf(id,32),buf=encodePng(im);
    fs.mkdirSync(path.dirname(path.join(out,file)),{recursive:true});fs.writeFileSync(path.join(out,file),buf);console.log('[cut]',id);
    const src=id.endsWith('snow')?TERRAINS:LPC_BASE; // the snow set carries the atlas's Snow block too
    if(idx)idx.assets[id+'@32']={id,kind:'autotile',file,w:im.w,h:im.h,sha256:sha256(buf),tier:32,source:src.source,license:src.license,authors:src.authors,accepted:new Date().toISOString().slice(0,10)}}
  if(idx){idx.assets=Object.fromEntries(Object.keys(idx.assets).sort().map(k=>[k,idx.assets[k]]));fs.writeFileSync(ip,JSON.stringify(idx,null,2)+'\n')}}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
