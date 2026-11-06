// Town buildings from the LPC house and castle kits (#833, epic #830): one cutter per town style, working to the town plans
// (`CITY[i].buildings`, #793) of every world, so a door in the plan is a door in the art.
//
//   node scripts/art/packcut-buildings.mjs [--out DIR] [--only stone-hall,...] [--index]      (npm run art:lpc-buildings)
//
// The kit is a set of parts, not a building: LPC's house is seven tiles tall and its door alone as tall as a hero. Our footprints
// are three by two tiles, so nothing here is one piece of LPC; every building is laid up from parts at LPC's own pixel scale
// (nothing is scaled, a part is only cropped or tiled):
//   house.png        slate courses (the roof), quoins, door, window, steps, porch posts and lintel, plinth
//   castle_outside   ashlar courses (the stone style's wall)
//   bridges.png      deck boards (the timber style's wall) and posts
//   signs.png        the INN and sword plaques, the frame the auction house's coin sits in
// Every part is recoloured to its role in palette.js TOWN.<style>: a part's own light to dark runs along the role's ramp, so
// the LPC shading and texture stay and the colours are the town's. Light from the top left.
//
// Height: a piece may stand taller than its footprint (`rise`, whole tiles of art over the tiles behind it), where the plan has
// nothing to walk on behind it: the north row stands against the town wall. Terrain art never hides an
// entity, so a piece must not rise over walkable ground; the check below refuses a rise that would.
//
// Assets: `building:lpc-<style>-<piece>`, no manifest row (nothing generates them), `source` and `license` on the entry. The
// entry also says what the renderer must know: `foot` [w, h] tiles and `door` [x, y] tile inside it (a building of another
// shape or door draws its procedural form, never this one stretched), and `spots` {chimney, flag} in art pixels from the top
// left of the image, where the town life (src/render/townlife.js) puts the smoke and the pennant.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {decodePng,encodePng} from './png.mjs';
import {sha256,fileOf} from './lib.mjs';
import {LPC_TILES} from './packcut.mjs';
import {TOWN,MARK} from '../../src/render/palette.js';
import {WORLDS} from '../../src/world/spec.js';
import {buildWorld} from '../../src/world/gen.js';
import {townStyle} from '../../src/data/townart.js';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','..');
const T=32;
export const LPC_KIT={source:'lpc-base',license:'CC-BY-SA 3.0',authors:['Leana Zimmerman (Sharm)','Daniel Armstrong (HughSpectrum)'],
  url:'https://opengameart.org/content/liberated-pixel-cup-lpc-base-assets-sprites-map-tiles'};

// ---- pixels ----
const rgb=h=>[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];
const blank=(w,h)=>({w,h,data:new Uint8Array(w*h*4)});
const get=(im,x,y)=>{const o=(y*im.w+x)*4;return [im.data[o],im.data[o+1],im.data[o+2],im.data[o+3]]};
function set(im,x,y,c){if(x<0||y<0||x>=im.w||y>=im.h)return;const o=(y*im.w+x)*4;im.data[o]=c[0];im.data[o+1]=c[1];im.data[o+2]=c[2];im.data[o+3]=255}
const rect=(im,x,y,w,h,c)=>{const k=typeof c==='string'?rgb(c):c;for(let j=0;j<h;j++)for(let i=0;i<w;i++)set(im,x+i,y+j,k)};
const lum=p=>p[0]*.3+p[1]*.59+p[2]*.11;
const mix=(a,b,t)=>a.map((v,i)=>Math.round(v+(b[i]-v)*t));
// A ramp from dark to light as a function of t in 0..1, in `steps` flat bands: pixel art stays banded after a recolour.
function ramp(cols,steps=6){const c=cols.map(rgb);return t=>{const q=Math.round(Math.max(0,Math.min(1,t))*(steps-1))/(steps-1)*(c.length-1),i=Math.min(c.length-2,Math.floor(q));return mix(c[i],c[i+1],q-i)}}
const down=(h,k=.6)=>'#'+rgb(h).map(v=>Math.round(v*k).toString(16).padStart(2,'0')).join('');

// ---- the kit ----
const sheets=new Map();
function sheet(n){if(!sheets.has(n))sheets.set(n,decodePng(fs.readFileSync(path.join(LPC_TILES,n+'.png'))));return sheets.get(n)}
// A part: a rect of a sheet, its light range measured once so a crop of it keeps the part's own shading.
export const PARTS={
  slate:['house',100,132,88,56],       // the courses of the big slate panel, inside its frame
  ashlar:['castle_outside',162,97,94,31], // three courses of dressed stone
  boards:['bridges',129,129,62,47],    // three deck boards
  quoinL:['house',0,8,16,72],
  quoinR:['house',80,8,16,72],
  plinth:['house',0,82,96,12],
  door:['house',161,1,30,47],
  window:['house',226,0,28,32],
  steps:['house',128,16,32,24],
  post:['house',233,96,6,46],
  lintel:['house',232,90,48,6],
  inn:['signs',8,4,24,23],
  sword:['signs',40,4,24,23],
};
const range=new Map();
function lightOf(name){if(range.has(name))return range.get(name);const [s,x,y,w,h]=PARTS[name],im=sheet(s),v=[];
  for(let j=0;j<h;j++)for(let i=0;i<w;i++){const p=get(im,x+i,y+j);if(p[3]>=128)v.push(lum(p))}
  v.sort((a,b)=>a-b);const r=[v[Math.floor(v.length*.02)],v[Math.floor(v.length*.98)]];range.set(name,r);return r}
// Lay part `name` at dx,dy (over w x h, tiled when larger than the part, cropped when smaller), along ramp R. o.sx,o.sy start
// inside the part, o.bias lifts or darkens, o.at(x, y) adds a bias per pixel, o.pick(pixel) keeps only some pixels.
function lay(dst,name,dx,dy,w,h,R,o={}){const [s,x,y,pw,ph]=PARTS[name],im=sheet(s),[lo,hi]=lightOf(name),sx=o.sx||0,sy=o.sy||0;
  w=w??pw;h=h??ph;
  for(let j=0;j<h;j++)for(let i=0;i<w;i++){const p=get(im,x+(sx+i)%pw,y+(sy+j)%ph);if(p[3]<128)continue;if(o.pick&&!o.pick(p))continue;
    if(o.clip&&!o.clip(dx+i,dy+j))continue;
    set(dst,dx+i,dy+j,R((lum(p)-lo)/(hi-lo||1)+(o.bias||0)+(o.at?o.at(i,j):0)))}}

// ---- a town style's parts ----
function kit(style){const P=TOWN[style],line=MARK.outline||'#14101c';
  return {style,P,line,
    roof:ramp([down(P.roof[2],.7),P.roof[2],P.roof[1],P.roof[0]],7),
    wall:style==='stone'?ramp([P.wall[2],P.wall[1],P.wall[0]],5):ramp([down(P.wall[2],.8),P.wall[2],P.wall[1],P.wall[0]],6),
    mason:ramp([...P.stone].reverse(),6),
    door:ramp([down(P.door[1],.7),P.door[1],P.door[0],style==='stone'?'#7a5430':'#6a4830'],5),
    trim:ramp([...P.trim].reverse().concat(style==='stone'?[P.wall[2]]:[P.wall[2]]),5),
    frame:style==='stone'?ramp([P.wall[2],P.wall[1],P.wall[0]],4):ramp([P.trim[1],P.trim[0],P.wall[2]],4),
    gold:ramp([...P.gold].reverse().concat(['#ffe9a8']),4),
    glass:ramp([...P.glass].reverse(),3)}}

// ---- building blocks ----
// A roof seen from the south: the kit's courses, narrowing towards the ridge at the hip ends, lit from the top left.
function roof(im,K,x,y,w,h,{hip=10,sx=0}={}){const edge=j=>Math.round(hip*(1-j/(h-1)));
  lay(im,'slate',x,y,w,h,K.roof,{sx,sy:7,bias:-.12,at:(i,j)=>.28*(1-j/h)-(i>w*.72?.2:0)+(i<w*.12?.08:0),clip:(px,py)=>{const j=py-y,i=px-x,e=edge(j);return i>=e&&i<w-e}});
  for(let j=0;j<h;j++){const e=edge(j);set(im,x+e,y+j,rgb(K.line));set(im,x+w-e-1,y+j,rgb(K.line));set(im,x+e+1,y+j,K.roof(.85));set(im,x+w-e-2,y+j,K.roof(.1))}
  const e0=edge(0);rect(im,x+e0,y,w-2*e0,1,K.line);rect(im,x+e0+1,y+1,w-2*e0-2,2,K.roof(1));rect(im,x+e0+1,y+3,w-2*e0-2,1,K.roof(.15));
  rect(im,x,y+h-2,w,1,K.roof(.05));rect(im,x,y+h-1,w,1,K.line)}
function wall(im,K,x,y,w,h,{plinth=8,corners=true}={}){
  if(K.style==='stone'){lay(im,'ashlar',x,y,w,h-plinth,K.wall,{bias:.08,at:i=>i>w*.8?-.2:0})
    if(corners&&w>=48){lay(im,'quoinL',x,y,16,h-plinth,K.mason,{sy:4,bias:.5});lay(im,'quoinR',x+w-16,y,16,h-plinth,K.mason,{sy:4,bias:.3})}}
  else{lay(im,'boards',x,y,w,h-plinth,K.wall,{bias:-.08,at:i=>i>w*.8?-.2:0});
    if(corners)for(const px of w>=64?[x,x+Math.round(w/3)-2,x+Math.round(w*2/3)-2,x+w-5]:[x,x+w-5]){rect(im,px,y,5,h-plinth,K.trim(.3));rect(im,px,y,1,h-plinth,K.trim(.7));rect(im,px+4,y,1,h-plinth,K.trim(0))}}
  lay(im,'plinth',x,y+h-plinth,w,plinth,K.mason,{bias:K.style==='stone'?-.05:0});rect(im,x,y+h-plinth,w,1,K.mason(0));
  rect(im,x,y,w,2,K.style==='stone'?K.wall(0):K.trim(0)); // the eave's shadow
  rect(im,x,y,1,h,K.line);rect(im,x+w-1,y,1,h,K.line)}
// A door in the wall whose foot is at y (bottom of the opening), centred on cx, `w` wide.
function door(im,K,cx,y,{w=30,h=47}={}){const x=cx-(w>>1)-1;
  rect(im,x-1,y-h-1,w+4,h+1,K.line);rect(im,x,y-h,w+2,h,K.frame(.9));
  // a narrower door drops the middle of the kit's, so its stiles and hinges stay
  const half=w>>1,bias=K.style==='timber'?.22:0;lay(im,'door',x+1,y-h+1,half,h-1,K.door,{bias});lay(im,'door',x+1+half,y-h+1,w-half,h-1,K.door,{bias,sx:30-(w-half)})}
// The kit's window is two panes wide: one pane and the far frame make a window that fits between door and corner.
function windowAt(im,K,x,y,h=32){const W=17;rect(im,x-1,y-2,W+2,h+4,K.line);
  const glass=(dx,sx,w)=>{lay(im,'window',x+dx,y,w,h,K.frame,{sx,pick:p=>lum(p)>=60,bias:.1});lay(im,'window',x+dx,y,w,h,K.glass,{sx,pick:p=>lum(p)<60,at:(i,j)=>1.4-j/h*1.6})};
  glass(0,0,14);glass(14,25,3);rect(im,x,y-1,W,1,K.frame(1));rect(im,x-1,y+h,W+2,2,K.frame(.8));rect(im,x-1,y+h+1,W+2,1,K.frame(.3))}
function plaque(im,K,part,x,y){const G=K.gold,isIcon=p=>p[0]>p[2]*1.5;
  lay(im,part,x,y,undefined,undefined,K.mason,{pick:p=>!isIcon(p),bias:.15});lay(im,part,x,y,undefined,undefined,G,{pick:isIcon,bias:.1})}
function coin(im,K,x,y){const [,,,w,h]=PARTS.inn;lay(im,'inn',x,y,w,h,K.mason,{bias:.15,pick:p=>p[0]<=p[2]*1.5});
  const cx=x+12,cy=y+11;rect(im,cx-5,cy-5,10,10,K.mason(.45));
  for(let j=-5;j<=5;j++)for(let i=-5;i<=5;i++){const d=Math.hypot(i+.5,j+.5);if(d<=5.2)set(im,cx+i,cy+j,d>4?K.gold(0):K.gold(.65-(i+j)/14))}
  rect(im,cx-1,cy-3,2,6,K.gold(.1))}
function chimney(im,K,x,y,w,h){rect(im,x,y,w,h,K.line);lay(im,'ashlar',x+1,y+3,w-2,h-3,K.mason,{bias:-.1,at:i=>i>w*.6?-.25:.1});rect(im,x-1,y,w+2,3,K.mason(.7));rect(im,x-1,y,w+2,1,K.line);rect(im,x-1,y+3,w+2,1,K.line);rect(im,x+2,y+1,w-4,1,K.mason(0))}

// ---- the pieces, each to its footprint and door ----
// foot [w, h] tiles, door [x, y] inside it. Each returns {im, spots}. rise: tiles of art behind the footprint.
function hall(K,foot,dr,rise){const W=foot[0]*T,H=(foot[1]+rise)*T,im=blank(W,H),rf=42,wy=rf-1,wh=H-wy;
  wall(im,K,0,wy,W,wh);roof(im,K,0,0,W,rf,{hip:12});
  const dx=dr[0]*T+16,foot_=H;door(im,K,dx,foot_-3,{w:28,h:44});
  // a porch: the kit's posts and lintel round the door
  lay(im,'lintel',dx-24,wy+2,48,6,K.frame,{bias:.05});
  for(const px of [dx-22,dx+16]){lay(im,'post',px,wy+8,6,H-wy-11,K.frame,{bias:.1});rect(im,px-1,H-4,8,4,K.mason(.5))}
  windowAt(im,K,6,wy+10,26);windowAt(im,K,W-23,wy+10,26);
  return {im,spots:{flag:[W>>1,4]}}}
function auction(K,foot,dr,rise){const W=foot[0]*T,H=(foot[1]+rise)*T,im=blank(W,H),rf=42,wy=rf-1,wh=H-wy;
  wall(im,K,0,wy,W,wh);roof(im,K,0,0,W,rf,{hip:8,sx:30});
  coin(im,K,(W>>1)-12,rf-30);
  door(im,K,dr[0]*T+16,H-3,{w:30,h:45});
  windowAt(im,K,9,wy+10,32);windowAt(im,K,W-26,wy+10,32);
  return {im,spots:{}}}
function smithy(K,foot,dr,rise){const W=foot[0]*T,H=(foot[1]+rise)*T,im=blank(W,H),rf=48,wy=rf-1,wh=H-wy;
  wall(im,K,0,wy,W,wh,{corners:false});chimney(im,K,18,0,11,20);roof(im,K,0,12,W,rf-12,{hip:2,sx:60});plaque(im,K,'sword',4,rf-25);
  // the forge: an open shed, the kit's door taken off, an anvil before the fire
  const dx=W>>1,oh=34,ow=24,x=dx-(ow>>1),y=H-oh-3;rect(im,x-2,y-2,ow+4,oh+2,K.line);rect(im,x-1,y-1,ow+2,3,K.frame(.5));rect(im,x,y+2,ow,oh-2,'#1a1012');
  for(let j=0;j<10;j++)for(let i=0;i<10;i++){const t=j/10;if((i*7+j*3)%5<4*t+1&&Math.abs(i-5)<3+j/2)set(im,x+2+i,y+oh-12+j,rgb(t>.6?'#f07a22':'#c8401a'))}
  rect(im,x+12,y+oh-13,10,3,K.mason(.7));rect(im,x+15,y+oh-10,4,8,K.mason(.3));rect(im,x+13,y+oh-3,8,2,K.mason(.3));
  return {im,spots:{chimney:[23,1]}}}
function chapel(K,foot,dr,rise){const W=foot[0]*T,H=Math.round((foot[1]+rise)*T),im=blank(W,H),sp=56,wy=sp-2;
  wall(im,K,1,wy,W-2,H-wy,{corners:false,plinth:6});
  for(let j=0;j<sp;j++){const hw=Math.round(1+(W/2-2)*(j/sp));lay(im,'slate',(W>>1)-hw,j,2*hw,1,K.roof,{sy:j,sx:hw,bias:-.1,at:i=>i<hw?.22:-.22});set(im,(W>>1)-hw-1,j,rgb(K.line));set(im,(W>>1)+hw,j,rgb(K.line))}
  rect(im,0,sp-3,W,1,K.roof(.1));rect(im,0,sp-2,W,1,K.line);
  rect(im,(W>>1)-1,0,2,6,K.gold(.6));rect(im,(W>>1)-3,2,6,2,K.gold(.6));
  door(im,K,W>>1,H-2,{w:20,h:34});
  // a round window over the door
  const cy=wy+8;for(let j=-4;j<=4;j++)for(let i=-4;i<=4;i++){const d=Math.hypot(i,j);if(d<=4.5)set(im,(W>>1)+i,cy+j,d>3.2?rgb(K.line):K.glass(1-(j+4)/9))}
  return {im,spots:{}}}
function inn(K,foot,dr,rise){const W=foot[0]*T,H=(foot[1]+rise)*T,im=blank(W,H),rf=30,wy=rf-1,wh=H-wy,nx=dr[0]*T;
  wall(im,K,0,wy,W,wh,{plinth:6});
  roof(im,K,0,0,nx+4,rf,{hip:6});roof(im,K,nx+T-4,0,W-nx-T+4,rf,{hip:6,sx:40});chimney(im,K,W-20,2,10,14);
  // the way in: the plan's door is on the street side, the north, which this view cannot see. So the roof is cut for it, and
  // the kit's steps go down from the street to the lintel of a door under the eave.
  const x=nx+5,w=T-10;rect(im,x-1,0,w+2,T+1,K.line);lay(im,'steps',x,0,w,24,K.mason,{sx:4,bias:.2});rect(im,x,24,w,T-23,K.mason(.1));rect(im,x+2,T-5,w-4,6,K.line);lay(im,'door',x+3,T-4,w-6,5,K.door,{sy:30});
  plaque(im,K,'inn',(W>>1)-12,wy+6);windowAt(im,K,11,wy+7,18);windowAt(im,K,W-28,wy+7,18);
  return {im,spots:{chimney:[W-15,2]}}}
function board(K,foot){const W=foot[0]*T,H=foot[1]*T,im=blank(W,H);
  const posts=[4,W-8];for(const x of posts){lay(im,'boards',x,4,4,H-4,K.door,{bias:.1});rect(im,x+3,4,1,H-4,K.line)}
  lay(im,'boards',2,3,W-4,18,K.door,{bias:.15});rect(im,1,2,W-2,1,K.line);rect(im,1,21,W-2,1,K.line);rect(im,1,2,1,20,K.line);rect(im,W-2,2,1,20,K.line);
  rect(im,1,0,W-2,3,K.roof(.75));rect(im,1,0,W-2,1,K.line);
  for(const [x,y,w,h] of [[5,6,8,10],[15,5,6,7],[22,7,6,9]]){rect(im,x,y,w,h,K.style==='stone'?'#e8e0c8':'#b8a888');rect(im,x+1,y+2,w-2,1,K.line);rect(im,x+1,y+4,w-3,1,K.line)}
  return {im,spots:{}}}
export const RECIPES={hall,auction,smithy,chapel,inn,board};
// How far a piece stands above its footprint, in tiles (the chapel from its draw box, so the spire keeps its reach).
export const RISE={hall:1,auction:1,smithy:1,chapel:1.5,inn:0,board:0};

// ---- the plans ----
// Every building of every town of every world, by style and piece: the shapes to cut.
export function shapes(worlds=WORLDS){const out=new Map();
  for(const [wn,spec] of Object.entries(worlds)){const W=buildWorld(spec);
    for(const c of W.CITY)for(const b of c.buildings||[]){const st=townStyle(c),[x,y,w,h]=b.box,k=`${st}-${b.piece}`,door=[b.door[0]-x,b.door[1]-y],s=`${w}x${h}@${door}`;
      const e=out.get(k)||{style:st,piece:b.piece,foot:[w,h],door,seen:new Set(),towns:[]};e.seen.add(s);e.towns.push(`${wn}/${c.name}`);out.set(k,e);
      checkRise(c,b)}}
  return out}
// A piece may rise only over ground nobody walks: every tile behind it is the town wall or another building.
function checkRise(c,b){const r=Math.ceil(RISE[b.piece]||0),[x,y,w]=b.box,bad=[];
  const covered=(tx,ty)=>ty<=c.y0||(c.buildings||[]).some(q=>tx>=q.box[0]&&tx<q.box[0]+q.box[2]&&ty>=q.box[1]&&ty<q.box[1]+q.box[3]);
  for(let j=1;j<=r;j++)for(let i=0;i<w;i++)if(!covered(x+i,y-j))bad.push([x+i,y-j]);
  if(bad.length)throw new Error(`${c.name}: ${b.piece} would rise over walkable ground at ${bad.join(' ')}`)}

export function cutBuildings(){const out={};
  for(const e of shapes().values()){if(e.seen.size>1)console.log(`[cut] ${e.style}-${e.piece}: the plans disagree (${[...e.seen].join(', ')}): cut for the first, the rest draw procedurally`);
    const K=kit(e.style),f=RECIPES[e.piece];if(!f)continue;
    const {im,spots}=f(K,e.foot,e.door,RISE[e.piece]||0);
    out[`building:lpc-${e.style}-${e.piece}`]={im,foot:e.foot,door:e.door,spots}}
  return out}

function main(argv=process.argv.slice(2)){
  const o={};for(let i=0;i<argv.length;i++){if(argv[i]==='--out')o.out=argv[++i];else if(argv[i]==='--index')o.index=true;else if(argv[i]==='--only')o.only=argv[++i].split(',')}
  const out=o.out||path.join(ROOT,'assets'),cut=cutBuildings(),ip=path.join(ROOT,'assets','index.json'),idx=o.index?JSON.parse(fs.readFileSync(ip,'utf8')):null;
  for(const [id,{im,foot,door,spots}] of Object.entries(cut)){if(o.only&&!o.only.some(k=>id.endsWith(k)))continue;
    const file=fileOf(id,32),buf=encodePng(im);fs.mkdirSync(path.dirname(path.join(out,file)),{recursive:true});fs.writeFileSync(path.join(out,file),buf);console.log('[cut]',id,`${im.w}x${im.h}`);
    if(idx)idx.assets[id+'@32']={id,kind:'building',file,w:im.w,h:im.h,sha256:sha256(buf),tier:32,source:LPC_KIT.source,license:LPC_KIT.license,authors:LPC_KIT.authors,url:LPC_KIT.url,accepted:new Date().toISOString().slice(0,10),foot,door,...(Object.keys(spots).length?{spots}:{})}}
  if(idx){idx.assets=Object.fromEntries(Object.keys(idx.assets).sort().map(k=>[k,idx.assets[k]]));fs.writeFileSync(ip,JSON.stringify(idx,null,2)+'\n')}}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
