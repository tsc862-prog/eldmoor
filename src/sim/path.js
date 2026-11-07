// Paths, not straight lines (#794, slice 3 of the solid-world epic #791). moveTo (heroes.js) asks pathLeg where to walk now.
// Owned by ai-designer. No dice, so nothing here touches the RNG; the world's solid grid is fixed once built.
//
// What a walker does, cheapest first:
//   1. A cached path (e.path) is followed while its target stays within PATH.REPLAN tiles of where it was planned for.
//   2. Near (PATH.NEAR tiles) with a clear line: walk straight, nothing planned, nothing kept. Most steps are this one.
//   3. Else plan: A* on the tile grid, cost 1/SPEED per tile (so roads are cheap), then string-pulled into a few legs.
//      At most PATH.PER_TICK plans a tick: the rest keep their old path for a tick, or stand a tick if they have none.
// Mobs (not elites) plan within PATH.MOB_NODES nodes only: a mob only ever wants somewhere near, and a chase that would
// need more is called off (noWay). Their wander and chase are nearly always rule 2, which costs one line walk.
// A target on solid ground, or on land the walker cannot reach, is swapped for the nearest ground it can: it walks there and
// moveTo says it has arrived, so nobody freezes at a wall. Fact fields for the agent tools ride on the path (see route).
import {W,H,SPEED,BRIDGE} from '../world/tiles.js';
import {tiles,I,solid,land,CITY} from '../world/map.js';
import {WHY,crossing,stepOpen} from '../world/solidgrid.js';
import {nearestOpen} from '../world/passable.js';
import {S} from './state.js';
import {onWorld} from './kept.js';

export const PATH={
  PER_TICK:8,    // plans a tick, at most (a tick is 1/60 s at 1x: 8 a tick is far above the need, it guards the worst case)
  TICK_NODES:16000, // nodes a tick may search before further plans wait: what keeps a tick sane as the map grows (#31)
  NEAR:10,       // tiles: a clear line this short is simply walked
  REPLAN:2,      // tiles the target may move before the path is planned again
  OFF:3,         // tiles off the path (put there, thrown there) before it is dropped
  MOB_NODES:500, // nodes a common mob's search may look at
  HEUR:.9,       // heuristic per tile; above the cheapest step (1/1.3), so a search goes straight at a tiny cost in length
  SMOOTH:24,     // tiles a straightened leg may span
  GOAL_R:12};    // tiles around a solid target to look for ground to stand on
export const HOLD=0,DONE=1; // pathLeg's answers beside a point: stand this tick; arrived as near as the ground allows
export const pathStats={plans:0,nodes:0,peak:0,held:0,none:0,refused:0,us:0}; // recording only

const inb=(x,y)=>x>=0&&y>=0&&x<W&&y<H,fin=Number.isFinite;
let COST=null,N=0,G=null,FROM=null,SEEN=null,stamp=0,HI=null,HF=null,hn=0,used=0,usedAt=-1,usedNodes=0;
function ready(){if(COST)return;N=W*H;COST=new Float32Array(N);for(let i=0;i<N;i++)COST[i]=solid[i]?Infinity:1/SPEED[tiles[i]];
  G=new Float32Array(N);FROM=new Int32Array(N);SEEN=new Uint32Array(N);HI=new Int32Array(1024);HF=new Float32Array(1024)}

onWorld(()=>{COST=G=FROM=SEEN=HI=HF=null;N=0},()=>{ready();return {pathN:N,pathCost:Array.from(COST)}}); // another map (#1013): the next walk builds the grids again

// A new tick: the plan budget starts over. step() calls it; a clock that moved does the same for walkers driven outside step().
export function pathTick(){used=0;usedNodes=0;usedAt=S.gameMin}
export const noWay=e=>!!(e.path&&e.path.none);

// The time to walk the straight line between two points (tiles at pace 1), or Infinity when it touches solid ground.
// Tile by tile; a line through the exact corner of two tiles needs both beside it open.
export function lineCost(x0,y0,x1,y1){ready();
  let tx=Math.floor(x0),ty=Math.floor(y0);const ex=Math.floor(x1),ey=Math.floor(y1);
  if(!inb(tx,ty)||!inb(ex,ey))return Infinity;
  let c=COST[I(tx,ty)];if(c===Infinity)return c;
  const dx=x1-x0,dy=y1-y0,L=Math.hypot(dx,dy);if(tx===ex&&ty===ey)return c*L;
  const sx=dx>0?1:-1,sy=dy>0?1:-1,tdx=dx?Math.abs(1/dx):Infinity,tdy=dy?Math.abs(1/dy):Infinity;
  let mx=dx?((dx>0?tx+1:tx)-x0)/dx:Infinity,my=dy?((dy>0?ty+1:ty)-y0)/dy:Infinity,t=0,sum=0;
  for(let k=Math.abs(ex-tx)+Math.abs(ey-ty)+2;k>0;k--){let nt;
    if(Math.abs(mx-my)<1e-9){if(!inb(tx+sx,ty)||!inb(tx,ty+sy)||solid[I(tx+sx,ty)]||solid[I(tx,ty+sy)])return Infinity;
      nt=mx;tx+=sx;ty+=sy;mx+=tdx;my+=tdy}
    else if(mx<my){nt=mx;tx+=sx;mx+=tdx}else{nt=my;ty+=sy;my+=tdy}
    sum+=c*(nt-t)*L;t=nt;if(!inb(tx,ty))return Infinity;c=COST[I(tx,ty)];if(c===Infinity)return c;
    if(tx===ex&&ty===ey)return sum+c*(1-t)*L}
  return Infinity}
export const clearLine=(a,b)=>lineCost(a.x,a.y,b.x,b.y)<Infinity;
// What stands on the straight line between two points: 'river', 'wall', 'building', 'peak', 'lava', 'rock', 'forest', or null.
export function blockedBy(x0,y0,x1,y1){const L=Math.hypot(x1-x0,y1-y0);if(!fin(L)||!fin(x0)||!fin(y0))return null;
  for(let d=.25;d<=L;d+=.25){const x=Math.floor(x0+(x1-x0)*d/L),y=Math.floor(y0+(y1-y0)*d/L);if(!inb(x,y))return null;if(solid[I(x,y)])return WHY[solid[I(x,y)]]}return null} // stops at the map's edge: a target far off it must not cost a walk there

function push(f,i){if(hn===HI.length){const a=new Int32Array(hn*2),b=new Float32Array(hn*2);a.set(HI);b.set(HF);HI=a;HF=b}
  let k=hn++;while(k>0){const p=(k-1)>>1;if(HF[p]<=f)break;HF[k]=HF[p];HI[k]=HI[p];k=p}HF[k]=f;HI[k]=i}
function pop(){const top=HI[0],f=HF[--hn],v=HI[hn];let k=0;
  for(;;){let c=k*2+1;if(c>=hn)break;if(c+1<hn&&HF[c+1]<HF[c])c++;if(HF[c]>=f)break;HF[k]=HF[c];HI[k]=HI[c];k=c}
  HF[k]=f;HI[k]=v;return top}
// A* from tile s to tile t. Returns the tile list s..t, or null (no way within limit nodes; 0 = no limit).
function search(s,t,limit){stamp+=2;hn=0;const open=stamp,closed=stamp+1,tx=t%W,ty=(t-tx)/W,hm=PATH.HEUR;
  const heur=(x,y)=>{const a=Math.abs(x-tx),b=Math.abs(y-ty);return (a>b?a+.4142*b:b+.4142*a)*hm};
  G[s]=0;SEEN[s]=open;FROM[s]=-1;push(heur(s%W,(s-s%W)/W),s);let nodes=0,found=false;
  while(hn){const i=pop();if(SEEN[i]===closed)continue;SEEN[i]=closed;nodes++;if(i===t){found=true;break}if(limit&&nodes>=limit)break;
    const x=i%W,y=(i-x)/W;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;const nx=x+dx,ny=y+dy;if(!inb(nx,ny))continue;
      const j=I(nx,ny);if(SEEN[j]===closed||!stepOpen(solid,I,x,y,dx,dy))continue;
      const g=G[i]+COST[j]*(dx&&dy?1.4142:1);if(SEEN[j]===open&&g>=G[j])continue;
      G[j]=g;FROM[j]=i;SEEN[j]=open;push(g+heur(nx,ny),j)}}
  pathStats.nodes+=nodes;usedNodes+=nodes;if(nodes>pathStats.peak)pathStats.peak=nodes;
  if(!found)return null;const out=[];for(let i=t;i>=0&&out.length<=N;i=FROM[i])out.push(i);return out.length>N?null:out.reverse()} // never longer than the map

// The nearest ground on land l to (x,y), or null. Rings first; past them one pass over the map (rare: a target far inside rock).
function groundNear(x,y,l,scan){const o=nearestOpen(x,y,PATH.GOAL_R,p=>land[I(Math.floor(p.x),Math.floor(p.y))]===l);if(o||!scan)return o;
  let best=null,bd=Infinity;for(let i=0;i<N;i++){if(land[i]!==l)continue;const px=i%W+.5,py=(i-i%W)/W+.5,d=Math.hypot(px-x,py-y);if(d<bd){bd=d;best={x:px,y:py}}}return best}

// Straighten a tile list into a few legs. A leg may skip tiles only if it is clear and no slower than the tiles it skips,
// so a road that pays stays walked. Returns flat [x,y,...] from the first leg's end to (gx,gy).
function straighten(L,x0,y0,gx,gy){const n=L.length;if(n<2)return [gx,gy]; // ground in the walker's own tile
  const px=new Float64Array(n),py=new Float64Array(n),T=new Float64Array(n);
  for(let k=0;k<n;k++){const i=L[k];px[k]=i%W+.5;py[k]=(i-i%W)/W+.5}px[0]=x0;py[0]=y0;px[n-1]=gx;py[n-1]=gy;
  for(let k=1;k<n;k++)T[k]=T[k-1]+Math.hypot(px[k]-px[k-1],py[k]-py[k-1])*(COST[L[k]]+COST[L[k-1]])/2;
  const out=[];let i=0;
  while(i<n-1){let j=i+1;
    for(let k=i+2,m=Math.min(n-1,i+PATH.SMOOTH);k<=m;k++){if(lineCost(px[i],py[i],px[k],py[k])>(T[k]-T[i])*1.02)break;j=k}
    out.push(px[j],py[j]);i=j}
  return out}

// The way from (x0,y0) to (x,y), standing on open ground. Returns null when there is none within limit nodes, else
//   {pts, len, cross, why, near}: legs [x,y,...]; len, the tiles walked; cross, the bridges and fords used, in order,
//   [{k:'bridge'|'ford', x, y}]; why, what stands on the straight line ('river', 'wall', ...), when something does;
//   near, true when the target itself cannot be reached and this ends as close as the ground allows.
export function route(x0,y0,x,y,limit=0){ready();if(!fin(x)||!fin(y)||!inb(Math.floor(x0),Math.floor(y0))){pathStats.refused++;return null}const t0=performance.now();
  const s=I(Math.floor(x0),Math.floor(y0)),l=land[s];let gx=x,gy=y,near=false;
  if(!inb(Math.floor(x),Math.floor(y))||land[I(Math.floor(x),Math.floor(y))]!==l){const o=groundNear(x,y,l,!limit);if(!o)return null;gx=o.x;gy=o.y;near=true}
  const L=search(s,I(Math.floor(gx),Math.floor(gy)),limit);pathStats.plans++;
  if(!L){pathStats.us+=(performance.now()-t0)*1e3;return null}
  const pts=straighten(L,x0,y0,gx,gy),cross=[];let on=null;
  for(const i of L){const c=crossing(tiles[i],!solid[i]);
    if(c&&!on)cross.push(on={k:'ford',x:i%W,y:(i-i%W)/W});if(c&&tiles[i]===BRIDGE){on.k='bridge';on.x=i%W;on.y=(i-i%W)/W}if(!c)on=null} // one crossing a run of tiles; any bridge in it makes it a bridge
  let len=0,ax=x0,ay=y0;for(let k=0;k<pts.length;k+=2){len+=Math.hypot(pts[k]-ax,pts[k+1]-ay);ax=pts[k];ay=pts[k+1]}
  const r={pts,len:Math.round(len*10)/10};if(cross.length)r.cross=cross;const why=blockedBy(x0,y0,x,y);if(why)r.why=why;if(near)r.near=true;
  pathStats.us+=(performance.now()-t0)*1e3;return r}

const LEG={x:0,y:0};
const leg=(x,y)=>{LEG.x=x;LEG.y=y;return LEG};
const wp=p=>leg(p.pts[p.i],p.pts[p.i+1]);
const pathOk=p=>Array.isArray(p.pts)&&Number.isInteger(p.i)&&p.i>=0&&p.i%2===0&&fin(p.tx)&&fin(p.ty)&&fin(p.lx)&&fin(p.ly)&&(p.i>=p.pts.length||fin(p.pts[p.i])&&fin(p.pts[p.i+1]));
// Where e should walk now, on its way to (x,y): a point (reused: read it at once), HOLD or DONE.
export function pathLeg(e,x,y){ready();
  if(!fin(x)||!fin(y)){pathStats.refused++;e.path=null;return DONE} // no such place: nothing to walk to, and nobody waits on it
  if(!fin(e.x)||!fin(e.y)){pathStats.refused++;const o=nearestOpen(x,y,PATH.GOAL_R)||{x,y};e.x=o.x;e.y=o.y;e.path=null;return HOLD} // lost its own position: it stands at its target
  const sx=Math.floor(e.x),sy=Math.floor(e.y);
  if(!inb(sx,sy)||solid[I(sx,sy)]){const o=nearestOpen(e.x,e.y,PATH.GOAL_R);e.path=null;return o?leg(o.x,o.y):leg(x,y)} // put on solid ground somehow: out by the shortest way
  let p=e.path;
  if(p&&!pathOk(p)){pathStats.refused++;p=e.path=null} // a save or a bug left it unreadable: plan again
  if(p&&(Math.abs(e.x-p.lx)>PATH.OFF||Math.abs(e.y-p.ly)>PATH.OFF))p=e.path=null; // moved by something else: this path is not where they stand
  const near=Math.hypot(x-e.x,y-e.y)<=PATH.NEAR;
  if(p&&Math.hypot(x-p.tx,y-p.ty)<=PATH.REPLAN){
    if(p.none)return DONE;
    if(p.i<p.pts.length)return wp(p);
    return near&&lineCost(e.x,e.y,x,y)<Infinity?leg(x,y):DONE} // end of the path: the last step to a target that shifted, else this is as near as it gets
  if(near&&lineCost(e.x,e.y,x,y)<Infinity){e.path=null;return leg(x,y)}
  if(usedAt!==S.gameMin)pathTick();
  if(used>=PATH.PER_TICK||usedNodes>=PATH.TICK_NODES){pathStats.held++;return p&&!p.none&&p.i<p.pts.length?wp(p):HOLD}
  used++;
  const r=route(e.x,e.y,x,y,e.kind==='mob'&&!e.elite?PATH.MOB_NODES:0);
  if(!r){pathStats.none++;e.path={tx:x,ty:y,none:1,pts:[],i:0,lx:e.x,ly:e.y};return DONE}
  r.tx=x;r.ty=y;r.i=0;r.lx=e.x;r.ly=e.y;e.path=r;return wp(r)}
// A leg's end was reached: on to the next.
export function pathReached(e){const p=e.path;if(p){if(p.i<p.pts.length)p.i+=2;p.lx=e.x;p.ly=e.y}}
// The tick's step ends at (nx,ny). False when that is solid ground (the path is dropped, the walker plans again next tick);
// one already standing on solid is walking out of it and goes on.
export function pathStep(e,nx,ny){const tx=Math.floor(nx),ty=Math.floor(ny);
  if(inb(tx,ty)&&!solid[I(tx,ty)]||solid[I(Math.floor(e.x),Math.floor(e.y))]){const p=e.path;if(p){p.lx=nx;p.ly=ny}return true}
  e.path=null;return false}
// The door a point stands in, as {piece, serves, town}, or null: the fact move_to's answer carries (#794).
export function doorAt(x,y){const tx=Math.floor(x),ty=Math.floor(y);
  for(const c of CITY)for(const b of c.buildings||[])if(b.door&&b.door[0]===tx&&b.door[1]===ty)return {piece:b.piece,serves:b.serves||null,town:c.name};return null}
