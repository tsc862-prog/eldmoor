// A harbour where a town has a jetty (#979): a spec town's `pier` rects say where one reaches into the water, and this dresses the ground beside it from the tiles alone, no town
// named: a plank quay along the bank each side of the jetty, posts on its edge, and boats, crates, barrels, a net rack and two lamps on and beside it. Render only: the quay lies
// over tiles that are what they were, nothing here is solid and no sim state is read, so no hash moves. The planks are painted into the chunks (terrain.js decorate); whatever stands
// up goes on the y-sorted list, so people pass in front of it and behind it, and boats ride the water. Only a jetty running out from the land (taller than it is wide) is dressed.
// Crates, barrels, posts, torches and the deck are the pieces of the scenery sheet, each with a plain stand-in when it is not loaded; the boats and the net are drawn here, in the LPC
// ramps (light from the top left, dark outline).
import {RIVER,BRIDGE,ROAD,TREE} from '../world/tiles.js';
import {tiles,I,CITY,MAP_ID} from '../world/map.js';
import {MAPS} from '../world/spec.js';
import {onWorld} from '../sim/kept.js';
import {hash} from '../core/rng.js';
import {U,ART} from './tile.js';
import {FAC} from '../data/factions.js';
import {HARBOUR,MARK} from './palette.js';
import {scenePiece,scenePieceSize} from './scenery.js';
import {F} from './life.js';

const REACH=9; // tiles of quay each side of a jetty
const LIP=.45; // how far the planks run out over the water's tile, past the painted bank
const LINE=MARK.outline||'#14101c',{hull:HULL,inner:INNER,rim:RIM,sail:SAIL,net:NET,plank:PLANK}=HARBOUR;

// Where each harbour's quay lies: a list of columns {x, top, water}, the rows from `top` down to the row of `water`.
let plans=null;
function column(x,from,to){let y=from;while(y<=to&&tiles[I(x,y)]===ROAD)y++;const top=y;while(y<=to&&tiles[I(x,y)]!==RIVER&&tiles[I(x,y)]!==BRIDGE){if(tiles[I(x,y)]===TREE)return null;y++}return y>to?null:{x,top,water:y}}
function plan(){if(plans)return plans;plans=[];(MAPS[MAP_ID].towns||[]).forEach((t,i)=>{const c=CITY[i];if(!c)return;
  for(const [dx,dy,w,h] of t.pier||[]){if(h<=w)continue;const x0=c.x0+dx,x1=x0+w-1,y0=c.y0+dy,y1=y0+h-1,cols=[],east=[],west=[];
    for(let x=x0;x<=x1;x++){const q=column(x,y0,y1);if(q)cols.push(q)}
    for(const [out,step,first] of [[east,1,x1+1],[west,-1,x0-1]])for(let n=0,x=first;n<REACH;n++,x+=step){const q=column(x,y0,y1);if(!q)break;if(n)q.top=Math.max(q.top,out[0].top);else q.first=true;cols.push(q);out.push(q)} // the quay keeps to the line of the street behind it
    for(const r of [east,west])if(r.length)r[r.length-1].end=step0(r);
    plans.push({c,x0,x1,y0,y1,cols,east,west,ents:null,lamps:null})}});return plans}

// What of the water's tiles the planks lie over, for those who paint on water (water.js glints and foam, sheen.js): a tile's top rows on its water row.
let over=null;
onWorld(()=>{plans=over=null}); // another map (#1013)
export const quayOver=(x,y)=>{if(!over){over=new Set();for(const P of plan())for(const q of P.cols)for(let r=q.top;r<=q.water;r++)over.add(quayKey(q.x,r))}return over.has(quayKey(x,y))};
const quayKey=(x,y)=>y*4096+x;
export const quayLip=()=>{const r=[];for(const P of plan())for(const q of P.cols)if(tiles[I(q.x,q.water)]!==BRIDGE)r.push([q.x,q.water,LIP+.3]);return r};
const step0=r=>r.length>1?Math.sign(r[1].x-r[0].x):0; // which way a run of the quay goes: its last column gets an end
// The quay's planks and its edge for tiles [x0,x1)x[y0,y1) on a chunk, in world units.
function planks(c,x,y){if(scenePiece(c,'deck',x*U,y*U)){c.fillStyle=`rgba(40,26,18,${(.1+hash(x,y,951)*.14).toFixed(2)})`;c.fillRect(x*U,y*U,U,U);return} // the weather has been at it, some boards more than others
c.fillStyle=PLANK[1];c.fillRect(x*U,y*U,U,U);c.fillStyle=PLANK[0];for(let j=0;j<U;j+=4)c.fillRect(x*U,y*U+j,U,.5)}
export function drawQuay(c,x0,y0,x1,y1){for(const P of plan())for(const q of P.cols){if(q.x<x0-1||q.x>x1||q.water<y0-1||q.top>y1+1)continue;
    for(let y=q.top;y<q.water;y++)planks(c,q.x,y);
    if(tiles[I(q.x,q.water)]===BRIDGE)continue; // the jetty runs on here
    const X=q.x*U,Y=(q.water+LIP)*U;c.save();c.beginPath();c.rect(X,q.water*U,U,LIP*U);c.clip();planks(c,q.x,q.water);c.restore();
    if(q.end){const E=q.end>0?X+U-2:X,T0=q.top*U;c.fillStyle=HULL[0];c.fillRect(E,T0,2,Y-T0+3);c.fillStyle=HULL[2];c.fillRect(E+(q.end>0?0:1),T0,1,Y-T0)}
    c.fillStyle=PLANK[2];c.fillRect(X,Y-.5,U,.5);c.fillStyle=HULL[1];c.fillRect(X,Y,U,2.5);c.fillStyle=HULL[0];c.fillRect(X,Y+2.5,U,1);c.fillStyle='rgba(10,16,34,.3)';c.fillRect(X,Y+3.5,U,2)}}

// ---- boats, drawn once ----
const mk=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c};
// A hull lying along the bank seen from the south and above: its rim as a long pointed oval, the inside, and the planks of its near side. L long, B wide, S side, in art pixels; top: room over it.
function boat(L,B,S,top,fac,mast){const cv=mk(L+4,B+S+top+6),x=cv.getContext('2d'),px=(i,j,k)=>{x.fillStyle=k;x.fillRect(i,j,1,1)},cy=top+B/2,cx0=2;
  x.fillStyle='rgba(10,16,34,.28)';x.beginPath();x.ellipse(cv.width/2,top+B+S-1,L/2+1,B/2+1,0,0,7);x.fill(); // what it darkens on the water
  const half=u=>B/2*Math.pow(Math.max(0,1-Math.pow(Math.abs(u),2.6)),.6),dep=u=>S*Math.sqrt(Math.max(0,1-Math.pow(Math.abs(u),3.2)));
  for(let i=0;i<L;i++){const u=(i+.5)/L*2-1,h=half(u),d=dep(u),y0=Math.round(cy-h),y1=Math.round(cy+h),y2=Math.round(cy+h+d);
    for(let j=y1;j<y2;j++){const t=(j-y1)/Math.max(1,y2-y1),k=HULL[j-y1>=S-2?0:(j-y1)%3===2?1:t<.5?3:2];px(cx0+i,j,k)}
    px(cx0+i,y2,LINE);
    for(let j=y0;j<y1;j++){const e=Math.min(j-y0,y1-1-j),near=e<2;px(cx0+i,j,near?(j<cy?RIM[1]:RIM[0]):INNER[(i>>2)&1?1:0])}
    px(cx0+i,y0-1,LINE)}
  for(let i=0;i<L;i++){const u=(i+.5)/L*2-1,w=i%Math.round(L/4);if(w>=2||Math.abs(u)>=.7)continue;const h=half(u)-2;for(let y=Math.ceil(cy-h);y<cy+h;y++)px(cx0+i,y,RIM[w?0:1])} // the thwarts
  if(mast){const mx=Math.round(L*.46)+cx0,my=Math.round(cy);x.fillStyle=LINE;x.fillRect(mx-1,3,4,my-3);x.fillStyle=RIM[1];x.fillRect(mx,4,1,my-4);x.fillStyle=RIM[0];x.fillRect(mx+1,4,1,my-4);
    const yd=Math.round(top*.32),w=Math.round(L*.34);x.fillStyle=LINE;x.fillRect(mx-w-1,yd-1,2*w+4,7);x.fillStyle=SAIL[0];x.fillRect(mx-w,yd,2*w+2,5);x.fillStyle=SAIL[1];x.fillRect(mx-w,yd,2*w+2,2);for(let i=mx-w+3;i<mx+w;i+=6){x.fillStyle=SAIL[2];x.fillRect(i,yd,1,5)}
    const f=FAC[fac]||FAC[0];x.fillStyle=LINE;x.fillRect(mx+2,0,13,7);x.fillStyle=f.color;x.fillRect(mx+2,1,12,5);x.fillStyle=f.dark;x.fillRect(mx+2,4,12,2)}
  return cv}
// A rack of drying net: two posts, a pole and the mesh.
function netRack(){const w=44,h=34,cv=mk(w,h),x=cv.getContext('2d');x.fillStyle=LINE;x.fillRect(1,1,5,h-1);x.fillRect(w-6,1,5,h-1);x.fillRect(0,0,w,4);x.fillStyle=HULL[3];x.fillRect(2,2,3,h-3);x.fillRect(w-5,2,3,h-3);x.fillStyle=HULL[2];x.fillRect(1,1,w-2,2);
  for(let j=4;j<h-6;j++)for(let i=6;i<w-6;i++){const sag=Math.round(6*Math.sin((i-6)/(w-12)*Math.PI));if(j>h-8-sag&&j>10)continue;if((i+j)%5===0||(i-j+50)%5===0){x.fillStyle=(i+j)%2?NET[0]:NET[1];x.fillRect(i,j,1,1)}}return cv}

// ---- what stands ----
const stand=(x,y,paint)=>({kind:'deco',flat:true,x,y,paint});
// A piece of the sheet with its foot on the spot, or its stand-in.
const piece=(name,alt)=>(ctx,px,py)=>{const s=scenePieceSize(name);if(s&&scenePiece(ctx,name,px-s[0]/2,py-s[1]))return;ctx.fillStyle=LINE;ctx.fillRect(px-alt[0]/2-.5,py-alt[1]-.5,alt[0]+1,alt[1]+1);ctx.fillStyle=HULL[3];ctx.fillRect(px-alt[0]/2,py-alt[1],alt[0],alt[1])};
const crate=piece('crate',[13,12]),barrel=piece('barrel',[10,13]),post=piece('post',[3,9]),lamp=piece('torch',[3,24]);
const image=cv=>{const w=cv.width/ART,h=cv.height/ART;return (ctx,px,py)=>ctx.drawImage(cv,px-w/2,py-h,w,h)};
const riding=(cv,seed)=>{const w=cv.width/ART,h=cv.height/ART;return (ctx,px,py)=>ctx.drawImage(cv,px-w/2,py-h+Math.round(Math.sin(F.now*.9+seed))/ART,w,h)};
function dress(P){const e=[],{east:E,west:Wc,x0,x1,c}=P,at=(run,n)=>run[Math.min(n,run.length-1)];
  // boats: over the water's tiles off the quay, the big one where the water is widest
  const big=boat(92,20,9,52,c.fac,true),skiff=boat(56,13,6,2,c.fac,false);
  {const q=at(E,5),s=at(E,1);e.push(stand(q.x+.5,q.water+1.5,riding(big,1)),stand(s.x+.6,s.water+2.1,riding(skiff,2.7)))}
  {const q=at(Wc,3);e.push(stand(q.x+.5,q.water+1.55,riding(skiff,4.1)))}
  // posts along the edge, every other tile
  for(const run of [E,Wc])run.forEach((q,n)=>{if(n%2===1)e.push(stand(q.x+.5,q.water+LIP,post))});
  // goods on the quay, kept to the sides of the way to the jetty
  {const q=at(E,2),r=at(E,3);e.push(stand(q.x+.3,q.water-.15,crate),stand(q.x+.95,q.water-.05,crate),stand(r.x+.3,r.water-.1,barrel))}
  {const q=at(E,7);e.push(stand(q.x+.5,q.water-.05,image(netRack())))}
  {const q=at(Wc,1),r=at(Wc,3),s=at(Wc,5);e.push(stand(q.x+.2,q.top+.9,barrel),stand(q.x+.8,q.top+.75,barrel),stand(r.x+.5,r.water-.2,crate),stand(s.x+.5,s.water-.1,image(netRack())))}
  // lamps at the jetty's mouth
  P.lamps=[[x0-.25,at(Wc,0).water+LIP],[x1+1.25,at(E,0).water+LIP]];for(const [x,y] of P.lamps)e.push(stand(x,y,lamp));
  return e}
const seen=P=>P.x1+REACH+3>F.x0&&P.x0-REACH-3<F.x1&&P.y1+4>F.y0&&P.y0-3<F.y1;
// What stands in the harbours in view, onto the y-sorted list.
export function harbourEnts(ents){if(typeof document==='undefined')return;for(const P of plan()){if(!seen(P)||!P.west.length||!P.east.length)continue;if(!P.ents)P.ents=dress(P);for(const e of P.ents)ents.push(e)}}
// The harbour lamps, at dusk and through the night.
export function harbourLight(glow,dk,torch,flick){for(const P of plan()){if(!P.lamps||!seen(P))continue;for(const [x,y] of P.lamps)glow(x*U,y*U-26,46,torch,dk*1.1*flick(x,F.now))}}
