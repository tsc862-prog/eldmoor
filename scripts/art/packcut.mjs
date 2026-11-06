// Cutting free-set art (#789) into the shapes the renderer's asset tables expect: 32x32 ground tiles and dual-grid transition
// pieces (edge, corner, inner) from the LPC base terrain (assets/packs/lpc-base, CC-BY-SA 3.0 / GPL 3.0, authors in its
// CREDITS.TXT), written as ordinary assets with `source` and `license` on their index entries.
//
//   node scripts/art/packcut.mjs terrain|props [--out DIR] [--index]
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
export const LPC_TILES=path.join(process.env.ELDMOOR_PACKS||path.join(ROOT,'assets','packs'),'lpc-base','LPC Base Assets','tiles'); // ELDMOOR_PACKS: a packs folder kept outside this checkout
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


// ---- rocks and trees (#834), from Sharm's rock.png, treetop.png and trunk.png (same licence and author as the ground) ----
// Rocks: three one-tile props per biome (prop:rock-<biome>-1..3), cut at 1:1 and recoloured per biome (meadow as drawn; fen mossy;
// ash dark and warm grey; tundra cold and pale). Trees: LPC crowns are 3 tiles wide and 2.5 tall, so a tree is not a one-tile prop:
// prop:canopy-<biome>-1..3 are whole trees (crown over trunk and its ground shadow, 96x120, root at row 108) that terrain.js draws
// over the ground of its TREE tiles and over entities behind them. Nothing is scaled; shadows keep their alpha.
const BIOMES=['meadow','fen','ash','tundra'];
const mix=(a,b,k)=>a+(b-a)*k;
// per biome recolour of one pixel [r,g,b,a]; 'rock' and 'tree' have their own tones
function tone(p,biome,kind){let [r,g,b,a]=p;const l=(r*.3+g*.59+b*.11);
  if(biome==='meadow')return p;
  if(kind==='rock'){
    if(biome==='fen'){r=mix(r*.82,l*.78,.4);g=mix(g*.92,l*.95,.3)+6;b=mix(b*.74,l*.7,.4)}
    else if(biome==='ash'){const k=.62;r=mix(l,r,.55)*k+4;g=mix(l,g,.45)*k;b=mix(l,b,.45)*k-2}
    else{r=mix(r,l,.55)*.97+6;g=mix(g,l,.55)*1+12;b=mix(b,l,.4)*1.08+30}}
  else{
    if(biome==='fen'){r=r*.95+10;g=g*.8+6;b=b*.58;const m=l*.12;r+=m;g-=m*.4}                // drab olive, a little brown
    else if(biome==='ash'){const k=.7;r=mix(r,l,.5)*k+12;g=mix(g,l,.55)*k;b=mix(b,l,.5)*k-2}  // scorched, grey-green
    else{r=mix(r,l,.3)*.9+6;g=mix(g,l,.2)*.98+8;b=mix(b,l,.1)*1.1+16}}                        // frosted, cold
  const c=v=>Math.max(0,Math.min(255,Math.round(v)));return [c(r),c(g),c(b),a]}
const recolour=(im,biome,kind)=>{const o=blank(im.w,im.h);for(let y=0;y<im.h;y++)for(let x=0;x<im.w;x++){const p=px(im,x,y);put(o,x,y,p[3]?tone(p,biome,kind):p)}return o};
const sub=(im,x0,y0,w,h)=>{const o=blank(w,h);for(let y=0;y<h;y++)for(let x=0;x<w;x++)put(o,x,y,px(im,x0+x,y0+y));return o};
// alpha-over (keeps the shadow's own alpha, so a translucent shadow stays translucent)
function stamp(dst,src,ox,oy){for(let y=0;y<src.h;y++)for(let x=0;x<src.w;x++){const p=px(src,x,y);if(!p[3])continue;const X=x+ox,Y=y+oy;if(X<0||Y<0||X>=dst.w||Y>=dst.h)continue;
  const q=px(dst,X,Y),a=p[3]/255,qa=q[3]/255,oa=a+qa*(1-a);put(dst,X,Y,[0,1,2].map(i=>Math.round((p[i]*a+q[i]*qa*(1-a))/oa)).concat([Math.round(oa*255)]))}}
const sheetOf=n=>decodePng(fs.readFileSync(path.join(LPC_TILES,n+'.png')));
export const CANOPY_W=96,CANOPY_H=120,CANOPY_ROOT=108; // the canvas of a whole tree and the row its trunk meets the ground

export function cutProps(){
  const R=sheetOf('rock'),TT=sheetOf('treetop'),TK=sheetOf('trunk'),out={};
  // rocks: the oval one, the big one, a flat stone with a pebble; each sits low in its tile, centred
  const place=(parts)=>{const t=blank(T,T);for(const [im,x,y] of parts)stamp(t,im,x,y);return t};
  const oval=sub(R,44,8,17,22),big=sub(R,0,0,32,32),flat=sub(R,35,0,16,9),pebble=sub(R,34,13,12,9),lone=sub(R,53,26,8,6);
  const rocks=[place([[oval,8,9]]),place([[big,0,0]]),place([[flat,2,12],[pebble,17,21],[lone,5,25]])];
  for(const b of BIOMES)rocks.forEach((im,i)=>{out[`prop:rock-${b}-${i+1}`]=recolour(im,b,'rock')});
  // trees: broad crowns at (1,0,94x80) and (97,16,94x80), conifers at (4,101,85x91) and (102,117,85x91); trunks 25 px wide, root row 63
  const crown=[sub(TT,0,0,96,96),sub(TT,96,0,96,112),sub(TT,0,96,96,128),sub(TT,96,96,96,128)], // [broad, broad, conifer, conifer] as raw boxes
        box=[[1,0,94,80],[1,16,94,80],[4,5,85,91],[6,21,85,91]],ride=[24,24,10,10]; // bottom of the crown sits this far above the root row
  const tree=(k,trunkNo)=>{const o=blank(CANOPY_W,CANOPY_H),tr=sub(TK,trunkNo*96,0,96,96);stamp(o,tr,0,CANOPY_ROOT-63);
    const [bx,by,bw,bh]=box[k],c=sub(crown[k],bx,by,bw,bh);stamp(o,c,Math.round((CANOPY_W-bw)/2),CANOPY_ROOT-ride[k]-bh);return o};
  const T0=[tree(0,0),tree(1,1),tree(2,0),tree(3,1)];
  const mixes={meadow:[0,1,3],fen:[0,1,2],ash:[2,3,1],tundra:[2,3,2]};
  for(const b of BIOMES)mixes[b].forEach((k,i)=>{let im=recolour(T0[k],b,'tree');
    if(b==='tundra'&&k>=2){ // snow on the boughs: the upper part of the crown goes pale, in a speckle
      const top=CANOPY_ROOT-ride[k]-bh_of(k);
      for(let y=top;y<top+bh_of(k)*.7;y++)for(let x=0;x<im.w;x++){const p=px(im,x,y);if(p[3]<200)continue;const l=p[0]*.3+p[1]*.59+p[2]*.11,f=(1-(y-top)/(bh_of(k)*.7))*Math.min(1,l/50); // lighter pixels near the top first
        const q=Math.max(0,f-.08)*1.05;if(q>0)put(im,x,y,[mix(p[0],232,Math.min(.85,q)),mix(p[1],240,Math.min(.85,q)),mix(p[2],248,Math.min(.85,q)),p[3]].map((v,i)=>i<3?Math.round(v):v))}}
    out[`prop:canopy-${b}-${i+1}`]=im});
  return out}
const bh_of=k=>[80,80,91,91][k];

export const LPC_BASE={source:'lpc-base',license:'CC-BY-SA 3.0',authors:['Leana Zimmerman (Sharm)'],
  url:'https://opengameart.org/content/liberated-pixel-cup-lpc-base-assets-sprites-map-tiles'};

function main(argv=process.argv.slice(2)){
  const o={};for(let i=0;i<argv.length;i++){if(argv[i]==='--out')o.out=argv[++i];else if(argv[i]==='--index')o.index=true;else if(argv[i]==='--only')o.only=argv[++i].split(',')}
  const cmd=argv[0];if(cmd!=='terrain'&&cmd!=='props'){console.log('usage: node scripts/art/packcut.mjs terrain|props [--out DIR] [--only id,id] [--index]');return}
  const out=o.out||path.join(ROOT,'assets'),cut=cmd==='props'?cutProps():cutTerrain(),ip=path.join(ROOT,'assets','index.json'),idx=o.index?JSON.parse(fs.readFileSync(ip,'utf8')):null;
  for(const [id,im] of Object.entries(cut)){if(o.only&&!o.only.includes(id))continue;
    const file=fileOf(id,32),buf=encodePng(im);fs.mkdirSync(path.dirname(path.join(out,file)),{recursive:true});fs.writeFileSync(path.join(out,file),buf);console.log('[cut]',id,'->',path.join(out,file));
    if(idx){const prev=idx.assets[id+'@32']||{};idx.assets[id+'@32']={id,kind:id.split(':')[0],file,w:im.w,h:im.h,sha256:sha256(buf),tier:32,source:LPC_BASE.source,license:LPC_BASE.license,authors:LPC_BASE.authors,accepted:new Date().toISOString().slice(0,10),...(prev.model?{replaces:prev.model}:{})}}}
  if(idx){idx.assets=Object.fromEntries(Object.keys(idx.assets).sort().map(k=>[k,idx.assets[k]]));fs.writeFileSync(ip,JSON.stringify(idx,null,2)+'\n')}}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
