// Biome ground from the LPC terrain atlas (#835): fen grass, swamp water, mud, ash rock, snow, ice and lava as ground tiles, and
// the dual-grid transition pieces for every border the maps have between them and to road and meadow, cut with the same
// `pieces()` as the base terrain (packcut.mjs, #803). Sources, both read only under assets/packs/ (gitignored, `npm run art:packs`):
//   lpc-terrains/lpc-terrains/terrain-v7.png   "[LPC] Terrains", bluecarrot16 and others (authors in its CREDITS-terrain.txt),
//                                              CC-BY-SA 3.0 / 4.0, https://opengameart.org/content/lpc-terrains
//   lpc-base  tiles/lava.png, dirt.png, ...    Leana Zimmerman (Sharm), CC-BY-SA 3.0 (already used by packcut.mjs)
// The atlas is ten LPC blocks across (3x6 tiles: three plain tiles in the last row, a 3x3 island of the ground on transparency,
// a hole in the top-right 2x2), with bands seven tiles apart. The fen grass is the atlas Grass block turned olive (a hue and
// saturation shift: blade shapes and rim stay LPC's). Nothing is scaled.
//
//   node scripts/art/packcut-biomes.mjs [--out DIR] [--only id,id] [--index]
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {decodePng,encodePng} from './png.mjs';
import {sha256,fileOf} from './lib.mjs';
import {T,px,put,blank,over,tile,sheet,pieces,LPC_BASE} from './packcut.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','..');
export const LPC_TERRAINS=path.join(ROOT,'assets','packs','lpc-terrains','lpc-terrains','terrain-v7.png');
export const TERRAINS={source:'lpc-terrains',license:'CC-BY-SA 3.0',url:'https://opengameart.org/content/lpc-terrains',
  authors:['bluecarrot16','Lanea Zimmerman (Sharm)','Daniel Eddeland (Daneeklu)','Richard Kettering (Jetrel)','Zachariah Husiar (Zabin)','Hyptosis','Casper Nilsson','Buko Studios','Nushio','ZaPaper','billknye','William Thompson','caeles','Redshrike','Bertram','Rayane Felix (RayaneFLX)']};

// An LPC block whose top-left tile is (tx0,ty0) of a sheet: its three plain tiles, the 3x3 island and the 2x2 hole piece.
export function block(im,tx0,ty0){
  const island=blank(T*3,T*3),hole=blank(T*2,T*2);
  for(let ty=0;ty<3;ty++)for(let tx=0;tx<3;tx++)over(island,tile(im,tx0+tx,ty0+2+ty),tx*T,ty*T);
  for(let ty=0;ty<2;ty++)for(let tx=1;tx<3;tx++)over(hole,tile(im,tx0+tx,ty0+ty),(tx-1)*T,ty*T);
  return {plain:[0,1,2].map(c=>tile(im,tx0+c,ty0+5)),island,hole}}

const rgb2hsl=(r,g,b)=>{r/=255;g/=255;b/=255;const M=Math.max(r,g,b),m=Math.min(r,g,b),l=(M+m)/2;let h=0,s=0;
  if(M!==m){const d=M-m;s=l>.5?d/(2-M-m):d/(M+m);h=M===r?(g-b)/d+(g<b?6:0):M===g?(b-r)/d+2:(r-g)/d+4;h*=60}return [h,s,l]};
const hsl2rgb=(h,s,l)=>{h=(((h%360)+360)%360)/360;const q=l<.5?l*(1+s):l+s-l*s,p=2*l-q,f=t=>{t=(t+1)%1;return t<1/6?p+(q-p)*6*t:t<.5?q:t<2/3?p+(q-p)*(2/3-t)*6:p};
  return s===0?[l*255,l*255,l*255].map(Math.round):[f(h+1/3)*255,f(h)*255,f(h-1/3)*255].map(Math.round)};
// Recolour the opaque pixels of an image: hue shifted by dh degrees, saturation and lightness scaled; alpha kept.
export function tint(im,dh,ks,kl){const o=blank(im.w,im.h);
  for(let y=0;y<im.h;y++)for(let x=0;x<im.w;x++){const p=px(im,x,y);if(p[3]<1)continue;
    const [h,s,l]=rgb2hsl(p[0],p[1],p[2]),[r,g,b]=hsl2rgb(h+dh,Math.min(1,s*ks),Math.min(1,l*kl));put(o,x,y,[r,g,b,p[3]])}return o}
const tintBlock=(b,dh,ks,kl)=>({plain:b.plain.map(t=>tint(t,dh,ks,kl)),island:tint(b.island,dh,ks,kl),hole:tint(b.hole,dh,ks,kl)});

export function grounds(){
  const A=decodePng(fs.readFileSync(LPC_TERRAINS)),at=(i,band)=>block(A,i*3,band*7),base=n=>block(sheet(n),0,0);
  return {fen:tintBlock(at(0,1),FEN.dh,FEN.ks,FEN.kl),swamp:at(4,2),snowIce:at(2,3),snow:at(6,1),rock:at(4,0),mud:at(9,0),
    lava:base('lava'),dirt:base('dirt'),water:base('water'),grass:base('grass')}}
export const FEN={dh:-32,ks:.6,kl:.86};
// The plain variant (0-2) of each ground used as its tile and under the pieces (base sheets have one real plain tile, the middle).
export const PLAIN={fen:0,swamp:0,snow:0,snowIce:0,rock:2,mud:0,lava:1,dirt:1,water:1,grass:1};
export const BIOME_TILES={'tile:fen-grass':'fen','tile:swamp':'swamp','tile:mud':'mud','tile:ash-rock':'rock','tile:snow':'snow','tile:ice':'snowIce','tile:lava':'lava'};
// [id, A (the plain underneath), B (its island and hole drawn over it)]. ids are terrain.js PAIRS.
export const BIOME_PAIRS=[
  ['mud-fen','mud','fen'],['fen-swamp','fen','swamp'],['mud-swamp','mud','swamp'],['snow-ice','snowIce','snow'],
  ['ash-snow','snow','rock'],['fen-ash','rock','fen'],['meadow-ash','rock','grass'],['mud-ash','rock','mud'],['ash-lava','rock','lava'],
  ['meadow-snow','grass','snow'],['fen-snow','fen','snow'],['swamp-snow','snow','swamp'],['mud-snow','mud','snow'],['ice-ash','snowIce','rock'],
  ['fen-river','fen','water'],['snow-river','snow','water'],['meadow-fen','grass','fen'],
  ['road-fen','fen','dirt'],['road-mud','mud','dirt'],['road-ash','rock','dirt'],['road-snow','snow','dirt'],['road-swamp','swamp','dirt'],
  ['ice-fen','snowIce','fen'],['lava-snow','snow','lava'],['ash-swamp','rock','swamp'],['mud-river','mud','water'],['swamp-river','swamp','water'],['meadow-swamp','grass','swamp'],['meadow-mud','mud','grass'],['road-ice','snowIce','dirt']];
// fen-ash, meadow-ash, mud-ash and swamp-snow lay the softer ground over the other (#895): grass blades and banks make a finer edge than the
// ragged cobbles of the rock island or the star of the snow one.
// Grounds whose hole piece is a star (snow, ice): its edge is all points, no use as an inner corner, so the inner piece is made
// from the edge piece: each pixel takes the horizontal boundary (the edge) or the vertical one (the edge turned), whichever is nearer.
const STAR_HOLE=new Set(['snow','snowIce']);
export function synthInner(E){const o=blank(T,T),H=T>>1;
  for(let y=0;y<T;y++)for(let x=0;x<T;x++){const vert=x<H&&y<H?y<=x:x>=H&&y<H;put(o,x,y,vert?px(E,y,x):px(E,x,y))}return o}
const BASE_ONLY=new Set(['dirt','water','lava','grass']);
export function cutBiomes(){
  const g=grounds(),out={},plain=k=>g[k].plain[PLAIN[k]];
  for(const [id,k] of Object.entries(BIOME_TILES))out[id]={im:plain(k),src:k==='lava'?LPC_BASE:TERRAINS};
  for(const [id,a,b] of BIOME_PAIRS){
    const B=g[b],A=plain(a),ps=pieces(A,B.island,{im:B.hole,b:A}),src=BASE_ONLY.has(a)&&BASE_ONLY.has(b)?LPC_BASE:TERRAINS;
    out['autotile:'+id]={im:ps.edge,src};out['autotile:'+id+'-corner']={im:ps.corner,src};out['autotile:'+id+'-inner']={im:STAR_HOLE.has(b)?synthInner(ps.edge):ps.inner,src}}
  return out}

function main(argv=process.argv.slice(2)){
  const o={};for(let i=0;i<argv.length;i++){if(argv[i]==='--out')o.out=argv[++i];else if(argv[i]==='--index')o.index=true;else if(argv[i]==='--only')o.only=argv[++i].split(',')}
  const out=o.out||path.join(ROOT,'assets'),ip=path.join(ROOT,'assets','index.json'),idx=o.index?JSON.parse(fs.readFileSync(ip,'utf8')):null;
  for(const [id,{im,src}] of Object.entries(cutBiomes())){if(o.only&&!o.only.includes(id))continue;
    const file=fileOf(id,32),buf=encodePng(im);fs.mkdirSync(path.dirname(path.join(out,file)),{recursive:true});fs.writeFileSync(path.join(out,file),buf);console.log('[cut]',id);
    if(idx){const prev=idx.assets[id+'@32']||{};idx.assets[id+'@32']={id,kind:id.split(':')[0],file,w:im.w,h:im.h,sha256:sha256(buf),tier:32,source:src.source,license:src.license,authors:src.authors,accepted:new Date().toISOString().slice(0,10),...(prev.model?{replaces:prev.model}:prev.replaces?{replaces:prev.replaces}:{})}}}
  if(idx){idx.assets=Object.fromEntries(Object.keys(idx.assets).sort().map(k=>[k,idx.assets[k]]));fs.writeFileSync(ip,JSON.stringify(idx,null,2)+'\n')}}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
