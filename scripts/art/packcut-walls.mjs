// Town walls, towers, gate piers and plaza from the LPC castle kit (#830), stacked on the buildings' cutter (#833).
//
//   node scripts/art/packcut-walls.mjs [--out DIR] [--index]      (npm run art:lpc-walls)
//
// Why per side: a wall of the kit is drawn for this view, a face you look at from the south and a top you look down on, and its
// shading comes from the top left. A tile drawn as a north wall and turned by quarter turns would put its face on the wrong
// side and its light behind it. So nothing here is turned: each side is its own cut, and towers and piers are not sided at all.
//   wall-n  seen from inside: the merlons' backs, the walk, the wall's inner face down to the plaza
//   wall-s  seen from outside: the walk, the merlons, a string course, the outer face down to the grass
//   wall-w  from above: merlons on the outer (left) edge, throwing their shadow across the walk
//   wall-e  from above: merlons on the outer (right) edge, their inner sides lit, no shadow on the walk
//
// Parts (LPC base tiles, cropped or tiled, never scaled, recoloured along the town's ramps; light from the top left):
//   castlefloors_outside  the three flagstone layouts of the plaza; each slab gets a tone and a bevel of its own
//   castle_outside        ashlar courses (faces)
//   castlewalls           the round tower, the dentil band under the battlements
//   dirt                  the street, through the tile:road cut of the same kit: as it is in a stone town, along the town's own ramp (TOWN_GROUND street) where the paving is dark
//
// The palisade (a spec town's `wall: 'palisade'`): the same set and sizes in timber, for a town that would not raise stone. The kit has
// no stakes or log walls, so they are laid from its deck boards (bridges.png), each stake a board stood on end, sharpened; the
// blockhouses that stand for towers and piers wear the LPC Roofs shakes; the plaza is plank decking on the same boards.
//
// Assets: tile:lpc-<style>-plaza (a 4x4 tile patch, the palisade's decking 12x8), tile:lpc-<style>-street (one tile, a plan's streets only),
// tile:lpc-<style>-wall-<n|e|s|w> (two tiles long), and
// building:lpc-<style>-tower / -pier / -pier-tall. No manifest row, `source` and `license` on the entry. townart.js draws the set
// only when all of it is loaded, else the WALL and FLOOR tiles as ever.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {decodePng,encodePng} from './png.mjs';
import {sha256,fileOf} from './lib.mjs';
import {TOWN_GROUND,PALISADE} from '../../src/render/palette.js';
import {TOWN_STYLES} from '../../src/data/townart.js';
import {hash} from '../../src/core/rng.js';
import {LPC_KIT,LPC_ROOF_KIT,PARTS,blank,get,kit,lay,lum,ramp,rect,rgb,set,sheet} from './packcut-buildings.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','..');
const T=32;
Object.assign(PARTS,{
  column:['castlewalls',0,17,32,159],    // the round tower, top to foot
  dentil:['castlewalls',0,200,128,8],    // the band under the battlements
  course:['castle_outside',162,97,94,31],
});
const FLAGS=[[32,96],[32,128],[64,128]]; // the kit's three layouts, the set with the plainest contrast between slab and joint

// ---- flagstones ----
// One flagstone tile as joints: true where the kit draws a joint.
function joints(i,flip){const [fx,fy]=FLAGS[i],im=sheet('castlefloors_outside'),fill=lum(get(im,fx+16,fy+6));
  const out=new Uint8Array(T*T);for(let y=0;y<T;y++)for(let x=0;x<T;x++){const p=get(im,fx+(flip&1?T-1-x:x),fy+(flip&2?T-1-y:y));out[y*T+x]=lum(p)<fill-8?1:0}return out}
// A patch of w x h tiles, wrapping: every slab a tone of its own, lit on its top and left edges, shaded on its bottom and right.
function flags(w,h,R,seed,{tones=[.46,.52,.58,.64],hi=.2,lo=.18}={}){const W=w*T,H=h*T,J=new Uint8Array(W*H);
  for(let j=0;j<h;j++)for(let i=0;i<w;i++){const a=joints(Math.floor(hash(i,j,seed)*FLAGS.length),hash(i,j,seed+1)<.5?1:0);
    for(let y=0;y<T;y++)for(let x=0;x<T;x++)J[(j*T+y)*W+i*T+x]=a[y*T+x]}
  const at=(x,y)=>((y+H)%H)*W+(x+W)%W,tone=new Float32Array(W*H).fill(-1);let n=0;
  for(let s=0;s<W*H;s++){if(J[s]||tone[s]>=0)continue;const t=tones[Math.floor(hash(n++,7,seed+2)*tones.length)],st=[s];tone[s]=t;
    while(st.length){const q=st.pop(),x=q%W,y=(q/W)|0;for(const r of [at(x+1,y),at(x-1,y),at(x,y+1),at(x,y-1)])if(!J[r]&&tone[r]<0){tone[r]=t;st.push(r)}}}
  const im=blank(W,H);for(let y=0;y<H;y++)for(let x=0;x<W;x++){const q=y*W+x;if(J[q]){set(im,x,y,R(0));continue}
    const up=J[at(x,y-1)]||J[at(x-1,y)],dn=J[at(x,y+1)]||J[at(x+1,y)];set(im,x,y,R(tone[q]+(up?hi:0)-(dn?lo:0)))}
  return im}

// ---- a wall's parts ----
function kitOf(style){const K=kit(style),G=TOWN_GROUND[style],P=K.P.stone;return {...K,plaza:ramp(G.plaza,5),walk:ramp(G.walk,4),street:G.street?ramp(G.street,5):null,face:ramp([P[3],P[2],P[1],P[0]],6)}}
// The walk on top of a wall: flat like the kit's wall tops, with cross joints so a run reads as laid stone. `along` y or x.
function walk(im,K,x,y,w,h,along){rect(im,x,y,w,h,K.walk(.62));const n=along==='y'?h:w;
  for(let s=0;s<n;s+=16){if(along==='y'){rect(im,x,y+s,w,1,K.walk(.22));rect(im,x,y+s+1,w,1,K.walk(.8))}else{rect(im,x+s,y,1,h,K.walk(.22));rect(im,x+s+1,y,1,h,K.walk(.8))}}}
// An ashlar face over w x h at x,y. The course part does not tile at the wall's length, so a joint closes each repeat.
function faceOf(im,K,x,y,w,h,{bias=0,sx=0}={}){lay(im,'course',x,y,w,h,K.face,{bias,sx});rect(im,x,y,1,h,K.face(.15))}
// A merlon seen from the south: a capped block w wide, h tall, lit on its left.
function merlonS(im,K,x,y,w,h,{cap=2,bias=0}={}){rect(im,x,y,w,h,K.line);rect(im,x+1,y+1,w-2,cap,K.face(.8+bias));rect(im,x+1,y+1+cap,w-2,h-2-cap,K.face(.5+bias));rect(im,x+1,y+1+cap,1,h-2-cap,K.face(.65+bias));rect(im,x+w-2,y+1+cap,1,h-2-cap,K.face(.3+bias))}
// A merlon from above: its top, and the sliver of its south side this view shows.
function merlonTop(im,K,x,y,w,h){rect(im,x,y,w,h,K.line);rect(im,x+1,y+1,w-2,h-4,K.face(.72));rect(im,x+1,y+1,w-2,1,K.face(.86));rect(im,x+1,y+h-3,w-2,2,K.face(.38))}
const PERIOD=16,LEN=2*T;

function wallS(K){const im=blank(LEN,T);walk(im,K,0,0,LEN,9,'x');rect(im,0,0,LEN,1,K.line);rect(im,0,1,LEN,1,K.walk(.9));
  rect(im,0,7,LEN,3,K.walk(0));
  for(let x=0;x<LEN;x+=PERIOD)merlonS(im,K,x+2,6,11,11);
  rect(im,0,16,LEN,1,K.line);rect(im,0,17,LEN,1,K.face(.75));rect(im,0,18,LEN,1,K.face(.2));
  faceOf(im,K,0,19,LEN,11,{sx:9});rect(im,0,30,LEN,1,K.face(.1));rect(im,0,31,LEN,1,K.line);return im}
function wallN(K){const im=blank(LEN,T);rect(im,0,0,LEN,7,K.walk(0));
  for(let x=0;x<LEN;x+=PERIOD)merlonS(im,K,x+2,0,11,7,{cap:1,bias:-.2});
  walk(im,K,0,7,LEN,7,'x');rect(im,0,14,LEN,1,K.face(.8));rect(im,0,15,LEN,1,K.line);
  faceOf(im,K,0,16,LEN,14,{sx:31,bias:-.22});rect(im,0,16,LEN,2,K.face(.15));rect(im,0,30,LEN,1,K.face(.1));rect(im,0,31,LEN,1,K.line);return im}
function wallW(K){const im=blank(T,LEN);walk(im,K,0,0,T,LEN,'y');
  rect(im,0,0,8,LEN,K.walk(0));
  // the merlons' shadow lies on the walk to their right and below
  for(let y=0;y<LEN;y+=PERIOD){rect(im,8,y+1,3,13,K.walk(.1));merlonTop(im,K,0,y,9,12)}
  rect(im,0,0,1,LEN,K.line);rect(im,T-2,0,1,LEN,K.walk(1));rect(im,T-1,0,1,LEN,K.line);return im}
function wallE(K){const im=blank(T,LEN);walk(im,K,0,0,T,LEN,'y');
  rect(im,T-8,0,8,LEN,K.walk(0));
  for(let y=0;y<LEN;y+=PERIOD)merlonTop(im,K,T-9,y,9,12);
  rect(im,T-1,0,1,LEN,K.line);rect(im,1,0,1,LEN,K.walk(.2));rect(im,0,0,1,LEN,K.line);return im}

// A round tower two tiles tall: the kit's column for the body and its light, curved courses laid over it; a flat top in a ring of
// merlons, lit from the top left.
function tower(K){const W=T,H=2*T,im=blank(W,H),cx=15.5,cy=12.5,rx=15.5,ry=12.5;
  lay(im,'column',0,0,W,H-24,K.face,{bias:-.18,sy:16});lay(im,'column',0,H-24,W,24,K.face,{bias:-.18,sy:135});
  for(let y=14;y<H;y++)for(let x=1;x<W-1;x++){const p=get(im,x,y);if(p[3]<128)continue;const u=(x-cx)/rx,sag=ry*.55*Math.sqrt(Math.max(0,1-u*u)),yy=y-sag;
    const row=Math.floor(yy/8),off=row&1?2:0,joint=Math.floor(Math.asin(Math.max(-1,Math.min(1,u)))*2.5+off*.25),next=Math.floor(Math.asin(Math.max(-1,Math.min(1,(x+1-cx)/rx)))*2.5+off*.25);
    if(((yy%8)+8)%8<1||joint!==next)set(im,x,y,p.slice(0,3).map(v=>Math.round(v*.72)))}
  for(let y=0;y<27;y++)for(let x=0;x<W;x++){const u=(x-cx)/rx,v=(y-cy)/ry,r=Math.hypot(u,v);if(r>1)continue;
    if(r>.93){set(im,x,y,rgb(K.line));continue}
    const a=(Math.atan2(v,u)+Math.PI)/(Math.PI/4),gap=Math.abs(a-Math.round(a))<.14;
    if(r>.64){set(im,x,y,gap?rgb(K.line):K.face(.56-(u+v)*.3));continue}
    if(r>.58){set(im,x,y,rgb(K.line));continue}
    set(im,x,y,(u+v)<-.15?K.walk(.05):K.walk(.45))}
  rect(im,15,37,2,9,K.line);rect(im,14,40,4,2,K.line);return im}
// A square pier beside the gate: a battlemented top and, seen from the south, h pixels of face.
function pier(K,h){const W=T,top=20,H=top+h,im=blank(W,H);rect(im,0,0,W,top,K.walk(0));rect(im,6,7,W-12,top-14,K.walk(.5));
  for(let x=2;x<W-6;x+=10)merlonS(im,K,x,0,8,7,{cap:1,bias:-.15});
  merlonTop(im,K,0,6,7,9);merlonTop(im,K,W-7,6,7,9);
  for(let x=2;x<W-6;x+=10)merlonS(im,K,x,top-7,8,8);
  faceOf(im,K,1,top+1,W-2,h-1,{sx:40});rect(im,0,top,W,1,K.line);rect(im,0,H-1,W,1,K.line);rect(im,1,H-2,W-2,1,K.face(.1));
  rect(im,0,0,1,H,K.line);rect(im,W-1,0,1,H,K.line);
  if(h>30){rect(im,15,top+10,2,10,K.line);rect(im,14,top+14,4,2,K.line)}return im}

// ---- the palisade ----
const palKit=()=>{const K=kit('timber');return {...K,log:ramp(PALISADE.log,6),deck:ramp(PALISADE.deck,5)}};
// A board stood on end: the light across the stake from the kit's grain along the board, lit on its left.
const [BX,BY,BW]=[129,129,62];
function stake(im,K,x,y,w,h,{tip=5,bias=0,seed=0}={}){const s=sheet('bridges');
  for(let j=0;j<h;j++){const cut=j<tip?Math.ceil((tip-j)*(w/2)/tip):0;
    for(let i=cut;i<w-cut;i++){const p=get(s,BX+(j+seed*11)%BW,BY+2+(i*2+seed*5)%12),g=(lum(p)-90)/150;
      set(im,x+i,y+j,K.log(.34+g*.5+bias+(i<w*.35?.14:i>w*.68?-.2:0)))}
    if(cut>0||j===0){set(im,x+cut-1,y+j,rgb(K.line));set(im,x+w-cut,y+j,rgb(K.line))}
    set(im,x+cut,y+j,cut?rgb(K.line):K.log(.75+bias));if(!cut){set(im,x-1,y+j,rgb(K.line))}}}
// A run of stakes along the top of a box, their heads uneven like hand-cut timber.
function stakes(im,K,x,y,w,h,o={}){for(let s=0,n=0;s<w;s+=8,n++){const d=Math.floor(hash(n,3,o.seed||5)*3);stake(im,K,x+s,y+d,8,h-d,{seed:n,...o})}}
// The plank walk behind the stakes, boards across it.
const deck=(im,K,x,y,w,h,sx=0)=>lay(im,'boards',x,y,w,h,K.deck,{sx,bias:-.05});
// A stake's end seen from above: a sharpened log, lit from the top left.
function logEnd(im,K,x,y,d){const r=d/2;for(let j=0;j<d;j++)for(let i=0;i<d;i++){const u=i+.5-r,v=j+.5-r,q=Math.hypot(u,v);if(q>r)continue;set(im,x+i,y+j,q>r-1.1?rgb(K.line):K.log(.62-(u+v)/(d*1.3)-q/(r*5)))}}
function palS(K){const im=blank(LEN,T);deck(im,K,0,0,LEN,10);rect(im,0,0,LEN,1,K.line);stakes(im,K,0,3,LEN,28);rect(im,0,13,LEN,2,K.log(.1));rect(im,0,13,LEN,1,K.log(.55));rect(im,0,31,LEN,1,K.line);return im}
function palN(K){const im=blank(LEN,T);stakes(im,K,0,0,LEN,19,{bias:-.2,tip:4});rect(im,0,9,LEN,2,K.log(.05));rect(im,0,9,LEN,1,K.log(.4));
  rect(im,0,18,LEN,1,K.line);deck(im,K,0,19,LEN,11,20);rect(im,0,30,LEN,1,K.deck(0));rect(im,0,31,LEN,1,K.line);return im}
const palSide=(K,x0,flip)=>{const im=blank(T,LEN);deck(im,K,0,0,T,LEN,flip?30:9);
  const edge=flip?0:T-1;rect(im,edge,0,1,LEN,K.line);rect(im,flip?1:T-2,0,1,LEN,K.deck(.1));
  rect(im,x0-(flip?2:-2),0,10,LEN,K.line);for(let y=0;y<LEN;y+=8)logEnd(im,K,x0+(hash(y,1,9)<.5?0:1),y,9);
  if(!flip)for(let y=0;y<LEN;y+=8)rect(im,x0+10,y+1,2,6,K.deck(0)); // the stakes' shadow, on the walk to their right
  return im};
const palW=K=>palSide(K,0,false),palE=K=>palSide(K,T-10,true);
// A blockhouse: a shake roof over a log wall h pixels deep, corner posts, an arrow slit where it stands tall enough.
function block(K,H){const W=T,rf=19,im=blank(W,H);lay(im,'boards',1,rf,W-2,H-rf,K.log,{bias:-.06,at:i=>i>W*.7?-.18:.04});
  for(const x of [1,W-5]){rect(im,x,rf,4,H-rf,K.log(.3));rect(im,x,rf,1,H-rf,K.log(.7));rect(im,x+3,rf,1,H-rf,K.log(.02))}
  rect(im,0,rf,1,H-rf,K.line);rect(im,W-1,rf,1,H-rf,K.line);rect(im,0,H-1,W,1,K.line);rect(im,1,rf,W-2,2,K.log(0));
  const e=j=>Math.round(9*(1-j/(rf-1)));lay(im,'shake',0,0,W,rf,K.roof,{bias:-.1,at:(i,j)=>.24*(1-j/rf)-(i>W*.66?.2:0),clip:(x,y)=>x>=e(y)&&x<W-e(y)});
  for(let j=0;j<rf;j++){set(im,e(j),j,rgb(K.line));set(im,W-e(j)-1,j,rgb(K.line))}rect(im,e(0),0,W-2*e(0),1,K.line);rect(im,0,rf-1,W,1,K.line);
  if(H>40){rect(im,15,rf+13,2,11,K.line);rect(im,13,rf+17,6,2,K.line)}return im}
// Plank decking: rows of boards cut to lengths of their own, each with its tone, some grain and now and then a knot. The kit's board has
// its marks only at its two ends, so they go where a board really ends: tiled along a row they came back every 62 pixels as a pattern.
const BOARD=62,END=6;
function planks(w,h,K,seed){const W=w*T,H=h*T,im=blank(W,H);
  for(let y=0,r=0;y<H;y+=16,r++){const sy=(r%3)*16,cuts=[];for(let x=Math.floor(hash(r,3,seed)*W),n=0,end=x+W;;n++){const len=52+Math.floor(hash(r,n,seed+4)*84);if(x+len>end-40){cuts.push([x,end-x,n]);break}cuts.push([x,len,n]);x+=len}
    for(const [x0,len,n] of cuts){const bias=(hash(r*31+n,2,seed)-.5)*.24,o={sy,bias},at=(sx,i,cw)=>lay(im,'boards',(x0+i)%W,y,cw,16,K.deck,{...o,sx});
      for(let i=0;i<len;i++)at(i<END?i:i>=len-END?BOARD-(len-i):END+(i-END)%(BOARD-2*END),i,1);
      for(let g=0,ng=1+Math.floor(hash(r,n,seed+5)*3);g<ng;g++){const gy=y+4+Math.floor(hash(n,g,seed+6+r)*8),gx=x0+8+Math.floor(hash(g,n,seed+7+r)*(len-30)),gl=6+Math.floor(hash(n+g,r,seed+8)*14);for(let i=0;i<gl;i++)set(im,(gx+i)%W,gy,K.deck(.26+bias))}
      if(hash(n,r,seed+9)<.16){const kx=x0+12+Math.floor(hash(r,n,seed+10)*(len-26)),ky=y+6+Math.floor(hash(n,r,seed+11)*4);for(const [i,j,t] of [[1,0,.1],[2,0,.1],[0,1,.1],[1,1,0],[2,1,0],[3,1,.1],[1,2,.1],[2,2,.1],[4,1,.3]])set(im,(kx+i)%W,ky+j,K.deck(t))}
      const e=x0%W;rect(im,e,y,1,16,K.deck(0));rect(im,(e+1)%W,y+1,1,14,K.deck(.85))}
    rect(im,0,y,W,1,K.deck(0))}
  return im}
const PALISADE_PIECES={plaza:K=>planks(12,8,K,23),'wall-n':palN,'wall-e':palE,'wall-s':palS,'wall-w':palW,tower:K=>block(K,2*T),pier:K=>block(K,T),'pier-tall':K=>block(K,2*T)};

// A town's street: the road's own dirt where the paving is light, along the town's ramp where a street that bright would not sit in it.
function street(K){const src=decodePng(fs.readFileSync(path.join(ROOT,'assets','tile','32','road.png')));if(!K.street)return src;const im=blank(src.w,src.h),v=[];
  for(let y=0;y<im.h;y++)for(let x=0;x<im.w;x++)v.push(lum(get(src,x,y)));const lo=Math.min(...v),hi=Math.max(...v);
  for(let y=0;y<im.h;y++)for(let x=0;x<im.w;x++)set(im,x,y,K.street((lum(get(src,x,y))-lo)/(hi-lo||1)));return im}
const PIECES={street,plaza:K=>flags(4,4,K.plaza,17),'wall-n':wallN,'wall-e':wallE,'wall-s':wallS,'wall-w':wallW,tower,pier:K=>pier(K,T-20),'pier-tall':K=>pier(K,2*T-20)};
const idOf=(style,k)=>`${k==='plaza'||k==='street'||k.startsWith('wall')?'tile':'building'}:lpc-${style}-${k}`;
export function cutWalls(){const out={};for(const style of Object.keys(TOWN_STYLES)){const K=kitOf(style);for(const [k,f] of Object.entries(PIECES))out[idOf(style,k)]=f(K)}
  const K=palKit();for(const [k,f] of Object.entries(PALISADE_PIECES))out[idOf('palisade',k)]=f(K);return out}

function main(argv=process.argv.slice(2)){
  const o={};for(let i=0;i<argv.length;i++){if(argv[i]==='--out')o.out=argv[++i];else if(argv[i]==='--index')o.index=true}
  const out=o.out||path.join(ROOT,'assets'),ip=path.join(ROOT,'assets','index.json'),idx=o.index?JSON.parse(fs.readFileSync(ip,'utf8')):null;
  for(const [id,im] of Object.entries(cutWalls())){const file=fileOf(id,32),buf=encodePng(im);
    fs.mkdirSync(path.dirname(path.join(out,file)),{recursive:true});fs.writeFileSync(path.join(out,file),buf);console.log('[cut]',id,`${im.w}x${im.h}`);
    const by=/^building:lpc-palisade/.test(id)?LPC_ROOF_KIT:LPC_KIT;
    if(idx)idx.assets[id+'@32']={id,kind:id.split(':')[0],file,w:im.w,h:im.h,sha256:sha256(buf),tier:32,source:by.source,license:by.license,authors:by.authors,url:by.url,accepted:idx.assets[id+'@32']?.accepted||new Date().toISOString().slice(0,10)}}
  if(idx){idx.assets=Object.fromEntries(Object.keys(idx.assets).sort().map(k=>[k,idx.assets[k]]));fs.writeFileSync(ip,JSON.stringify(idx,null,2)+'\n')}}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
