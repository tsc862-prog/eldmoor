// Cutting free-set art (#789) into the shapes the renderer's asset tables expect: 32x32 ground tiles and dual-grid transition
// pieces (edge, corner, inner) from the LPC base terrain (assets/packs/lpc-base, CC-BY-SA 3.0 / GPL 3.0, authors in its
// CREDITS.TXT), written as ordinary assets with `source` and `license` on their index entries.
//
//   node scripts/art/packcut.mjs terrain [--out DIR] [--index]
//
// LPC's terrain sheets are 3x6 tiles of 32 px: tile row 5 holds three plain ground tiles; rows 2-4 are a 3x3 "island" of that
// ground on transparency (so it lays over any other ground); the top-right 2x2 (rows 0-1, columns 1-2) is a hole of the other
// ground inside it. A transition piece is built the way our dual grid wants it (a 32 px window centred on a tile corner):
// the island over the other ground's plain tile, cut so the boundary runs through the middle (edge: other ground on top,
// island below), around its top-left corner (corner: island in the bottom-right quarter) and around the hole's bottom-right
// corner (inner: other ground in the top-left quarter, island elsewhere). Nothing is scaled; the pixels are LPC's.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {decodePng,encodePng} from './png.mjs';
import {sha256,fileOf} from './lib.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','..');
export const LPC_TILES=path.join(ROOT,'assets','packs','lpc-base','LPC Base Assets','tiles');
const T=32;
const px=(im,x,y)=>{const o=(y*im.w+x)*4;return [im.data[o],im.data[o+1],im.data[o+2],im.data[o+3]]};
const blank=(w,h)=>({w,h,data:new Uint8Array(w*h*4)});
const put=(im,x,y,p)=>{const o=(y*im.w+x)*4;im.data[o]=p[0];im.data[o+1]=p[1];im.data[o+2]=p[2];im.data[o+3]=p[3]};
const sheet=n=>decodePng(fs.readFileSync(path.join(LPC_TILES,n+'.png')));
const tile=(im,tx,ty)=>{const o=blank(T,T);for(let y=0;y<T;y++)for(let x=0;x<T;x++)put(o,x,y,px(im,tx*T+x,ty*T+y));return o};
function over(dst,src,ox,oy){for(let y=0;y<src.h;y++)for(let x=0;x<src.w;x++){const p=px(src,x,y);if(p[3]>=128&&x+ox>=0&&y+oy>=0&&x+ox<dst.w&&y+oy<dst.h)put(dst,x+ox,y+oy,[p[0],p[1],p[2],255])}}
function fillWith(dst,t){for(let y=0;y<dst.h;y++)for(let x=0;x<dst.w;x++)put(dst,x,y,px(t,x%T,y%T))}
function crop(im,x0,y0){const o=blank(T,T);for(let y=0;y<T;y++)for(let x=0;x<T;x++){const X=x0+x,Y=y0+y;put(o,x,y,X>=0&&Y>=0&&X<im.w&&Y<im.h?px(im,X,Y):[0,0,0,0])}return o}

// Where the island's boundary lies: the median first opaque row down the middle column of its top-middle tile, and likewise
// for the left edge of its middle-left tile, in island coordinates (0..95).
const med=a=>a.sort((p,q)=>p-q)[a.length>>1];
function bounds(b){
  const top=med([...Array(T).keys()].map(i=>{for(let y=0;y<T;y++)if(px(b,T+i,y)[3]>=128)return y;return T})),
        left=med([...Array(T).keys()].map(i=>{for(let x=0;x<T;x++)if(px(b,x,T+i)[3]>=128)return x;return T}));
  return {top,left}}

// pairs: ground A tile (plain) + island B over it
export function pieces(a,island,hole){
  const PAD=T,pad=T*3+PAD*2,{top,left}=bounds(island);
  const cv=blank(pad,pad);fillWith(cv,a);over(cv,island,PAD,PAD);
  const edge=crop(cv,PAD+T,PAD+top-16);           // middle column, boundary through the middle row
  const corner=crop(cv,PAD+left-16,PAD+top-16);   // top-left corner of the island at the window's centre
  // inner: the hole (ground A inside B) lies in the top-right 2x2 of the sheet; its bottom-right edge at the window's centre
  const hv=blank(T*2+PAD*2,T*2+PAD*2);fillWith(hv,tileOf(hole.b));over(hv,hole.im,PAD,PAD);
  const {x1,y1}=holeBox(hole.im);const inner=crop(hv,PAD+x1-16,PAD+y1-16);
  return {edge,corner,inner}}
let _tile=null;const tileOf=t=>t; // the B ground tile (plain) the hole sheet is drawn over
function holeBox(h){let x0=h.w,y0=h.h,x1=0,y1=0,cx=h.w/2,cy=h.h/2;
  // the hole is the transparent area around the centre: scan out from the centre for the first opaque pixel each way
  for(let x=cx;x<h.w;x++)if(px(h,x|0,cy|0)[3]<128)x1=x;else if(x1)break;
  for(let y=cy;y<h.h;y++)if(px(h,cx|0,y|0)[3]<128)y1=y;else if(y1)break;
  void x0;void y0;return {x1:x1+1,y1:y1+1}}

export function cutTerrain(){
  const g=sheet('grass'),d=sheet('dirt'),w=sheet('water');
  const grass=tile(g,1,5),road=tile(d,1,5),water=tile(w,1,5);
  const isl=im=>{const b=blank(T*3,T*3);for(let ty=0;ty<3;ty++)for(let tx=0;tx<3;tx++)over(b,tile(im,tx,2+ty),tx*T,ty*T);return b};
  const hole=im=>{const b=blank(T*2,T*2);for(let ty=0;ty<2;ty++)for(let tx=1;tx<3;tx++)over(b,tile(im,tx,ty),(tx-1)*T,ty*T);return b};
  const out={'tile:grass':grass,'tile:road':road,'tile:water':water};
  for(const [id,im,b] of [['grass-road',d,road],['bank-water',w,water]]){
    const ps=pieces(grass,isl(im),{im:hole(im),b:grass});
    out['autotile:'+id]=ps.edge;out['autotile:'+id+'-corner']=ps.corner;out['autotile:'+id+'-inner']=ps.inner;void b}
  return out}

export const LPC_BASE={source:'lpc-base',license:'CC-BY-SA 3.0',authors:['Leana Zimmerman (Sharm)'],
  url:'https://opengameart.org/content/liberated-pixel-cup-lpc-base-assets-sprites-map-tiles'};

function main(argv=process.argv.slice(2)){
  const o={};for(let i=0;i<argv.length;i++){if(argv[i]==='--out')o.out=argv[++i];else if(argv[i]==='--index')o.index=true;else if(argv[i]==='--only')o.only=argv[++i].split(',')}
  const cmd=argv[0];if(cmd!=='terrain'){console.log('usage: node scripts/art/packcut.mjs terrain [--out DIR] [--only id,id] [--index]');return}
  const out=o.out||path.join(ROOT,'assets'),cut=cutTerrain(),ip=path.join(ROOT,'assets','index.json'),idx=o.index?JSON.parse(fs.readFileSync(ip,'utf8')):null;
  for(const [id,im] of Object.entries(cut)){if(o.only&&!o.only.includes(id))continue;
    const file=fileOf(id,32),buf=encodePng(im);fs.mkdirSync(path.dirname(path.join(out,file)),{recursive:true});fs.writeFileSync(path.join(out,file),buf);console.log('[cut]',id,'->',path.join(out,file));
    if(idx){const prev=idx.assets[id+'@32']||{};idx.assets[id+'@32']={id,kind:id.split(':')[0],file,w:im.w,h:im.h,sha256:sha256(buf),tier:32,source:LPC_BASE.source,license:LPC_BASE.license,authors:LPC_BASE.authors,accepted:new Date().toISOString().slice(0,10),...(prev.model?{replaces:prev.model}:{})}}}
  if(idx){idx.assets=Object.fromEntries(Object.keys(idx.assets).sort().map(k=>[k,idx.assets[k]]));fs.writeFileSync(ip,JSON.stringify(idx,null,2)+'\n')}}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
