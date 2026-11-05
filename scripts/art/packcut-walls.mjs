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
//
// Assets: tile:lpc-<style>-plaza (a 4x4 tile patch), tile:lpc-<style>-wall-<n|e|s|w> (two tiles long), and
// building:lpc-<style>-tower / -pier / -pier-tall. No manifest row, `source` and `license` on the entry. townart.js draws the set
// only when all of it is loaded, else the WALL and FLOOR tiles as ever.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {encodePng} from './png.mjs';
import {sha256,fileOf} from './lib.mjs';
import {TOWN_GROUND} from '../../src/render/palette.js';
import {TOWN_STYLES} from '../../src/data/townart.js';
import {hash} from '../../src/core/rng.js';
import {LPC_KIT,PARTS,blank,get,kit,lay,lum,ramp,rect,rgb,set,sheet} from './packcut-buildings.mjs';

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
function kitOf(style){const K=kit(style),G=TOWN_GROUND[style],P=K.P.stone;return {...K,plaza:ramp(G.plaza,5),walk:ramp(G.walk,4),face:ramp([P[3],P[2],P[1],P[0]],6)}}
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

const PIECES={plaza:K=>flags(4,4,K.plaza,17),'wall-n':wallN,'wall-e':wallE,'wall-s':wallS,'wall-w':wallW,tower,pier:K=>pier(K,T-20),'pier-tall':K=>pier(K,2*T-20)};
const idOf=(style,k)=>`${k==='plaza'||k.startsWith('wall')?'tile':'building'}:lpc-${style}-${k}`;
export function cutWalls(){const out={};for(const style of Object.keys(TOWN_STYLES)){const K=kitOf(style);for(const [k,f] of Object.entries(PIECES))out[idOf(style,k)]=f(K)}return out}

function main(argv=process.argv.slice(2)){
  const o={};for(let i=0;i<argv.length;i++){if(argv[i]==='--out')o.out=argv[++i];else if(argv[i]==='--index')o.index=true}
  const out=o.out||path.join(ROOT,'assets'),ip=path.join(ROOT,'assets','index.json'),idx=o.index?JSON.parse(fs.readFileSync(ip,'utf8')):null;
  for(const [id,im] of Object.entries(cutWalls())){const file=fileOf(id,32),buf=encodePng(im);
    fs.mkdirSync(path.dirname(path.join(out,file)),{recursive:true});fs.writeFileSync(path.join(out,file),buf);console.log('[cut]',id,`${im.w}x${im.h}`);
    if(idx)idx.assets[id+'@32']={id,kind:id.split(':')[0],file,w:im.w,h:im.h,sha256:sha256(buf),tier:32,source:LPC_KIT.source,license:LPC_KIT.license,authors:LPC_KIT.authors,url:LPC_KIT.url,accepted:new Date().toISOString().slice(0,10)}}
  if(idx){idx.assets=Object.fromEntries(Object.keys(idx.assets).sort().map(k=>[k,idx.assets[k]]));fs.writeFileSync(ip,JSON.stringify(idx,null,2)+'\n')}}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
