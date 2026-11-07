// Spatial index: a uniform grid of CELL x CELL tiles over the map, rebuilt once per step
// from S.agents (living heroes) and S.mobs (alive, not gone). Every "which entities are
// near this point" scan in the sim asks this module instead of walking all of S.agents or
// S.mobs, so a 20-30x bigger world stays linear in the entities that are actually close.
//
// Contract: a query returns exactly the entities the brute-force scan would have seen,
// in the same order. Results are filtered by exact Euclidean distance (dist from map.js,
// inclusive: d <= r) and sorted by id; S.agents and S.mobs are both id-ascending (spliced,
// never reordered), so call sites that roll dice per candidate or break on the first hit
// consume the RNG in the same order as before. Call sites keep their own strict `<` checks.
//
// Positions move between the rebuild and a query (heroes act before mobs, PvP runs after
// both), so cells are scanned SLACK tiles beyond the radius; the exact distance filter then
// uses current positions. The largest move in one step is 0.26 tiles (ghost speed 4 x road
// 1.3 x the browser's 0.05 s step cap); the largest teleport is the crypt exit scatter of up
// to 1.33 tiles (dungeon.js); SLACK covers both. A mob that respawns mid-step is only looked
// for again after the next rebuild (heroes scan before mobs update). Entities that change
// state mid-step (die, enter the crypt) stay in the grid; every call site already filters on
// state and hidden, as the brute-force loops did.
//
// Module-level only: nothing here is stored on S, so the save/load serialiser never sees it.
// USE_INDEX=false (setIndex) makes every query a brute-force scan with the same filter,
// for A/B timing in scripts/scalecheck.mjs.
import {W,H} from '../world/tiles.js';
import {dist} from '../world/map.js';
import {S} from './state.js';
import {onWorld} from './kept.js';

export const CELL=4,SLACK=1.5;
let CW=Math.ceil(W/CELL)+1,CH=Math.ceil(H/CELL)+1; // +1 so a position exactly at W or H still has a cell

export let USE_INDEX=true;
export const setIndex=on=>{USE_INDEX=!!on};

// Counters for the headless report: entities indexed at the last rebuild, queries and
// candidates (entities inspected after the cell pass) since the start, and rebuild count.
export const spatialStats={cells:CW*CH,heroes:0,mobs:0,queries:0,candidates:0,rebuilds:0};

const cx=x=>{const c=Math.floor(x/CELL);return c<0?0:c>=CW?CW-1:c};
const cy=y=>{const c=Math.floor(y/CELL);return c<0?0:c>=CH?CH-1:c};
// A grid: per cell an array that only grows plus a fill count n[i]; used lists the cells filled since the last clear.
// #730: clearing resets the counts instead of truncating the arrays (truncating freed and regrew them every step);
// slots past a cell's count keep stale entries that nothing reads.
function grid(){const cells=[],n=new Int32Array(CW*CH),used=[];for(let i=0;i<CW*CH;i++)cells.push([]);
  return {cells,n,used,clear(){for(let k=0;k<used.length;k++)n[used[k]]=0;used.length=0},
    add(e){const i=cy(e.y)*CW+cx(e.x);if(!n[i])used.push(i);cells[i][n[i]++]=e}}}
let HG=grid(),MG=grid(); // heroes and mobs, rebuilt at the top of every step

export function rebuild(){
  HG.clear();MG.clear();let nh=0,nm=0;
  for(const a of S.agents){if(a.state==='dead')continue;HG.add(a);nh++}
  for(const m of S.mobs){if(!m.alive||m.gone)continue;MG.add(m);nm++}
  spatialStats.heroes=nh;spatialStats.mobs=nm;spatialStats.rebuilds++;LOD.tick++}

// #433: dist(a,b)<=r with a box test first. Math.hypot is never smaller than |dx| or |dy|, so anything outside
// the box is outside the circle; inside it the same Math.hypot decides, so the answer is identical to dist().
export const within=(a,b,r)=>{const dx=a.x-b.x;if(dx>r||dx<-r)return false;const dy=a.y-b.y;if(dy>r||dy<-r)return false;return Math.hypot(dx,dy)<=r};
const P={x:0,y:0};
const byId=(a,b)=>a.id-b.id;
function query(G,all,x,y,r,pred){spatialStats.queries++;P.x=x;P.y=y;const out=[];
  if(!USE_INDEX){for(const e of all){spatialStats.candidates++;if((!pred||pred(e))&&dist(P,e)<=r)out.push(e)}return out}
  const x0=cx(x-r-SLACK),x1=cx(x+r+SLACK),y0=cy(y-r-SLACK),y1=cy(y+r+SLACK);
  const cells=G.cells,N=G.n;
  for(let j=y0;j<=y1;j++)for(let i=x0;i<=x1;i++){const c=cells[j*CW+i],n=N[j*CW+i];
    for(let k=0;k<n;k++){const e=c[k];spatialStats.candidates++;if((!pred||pred(e))&&within(P,e,r))out.push(e)}}
  if(out.length>1)out.sort(byId);return out}

// Living heroes within r tiles of (x,y), id-ascending. pred(e) is an optional extra filter.
export const nearHeroes=(x,y,r,pred)=>query(HG,S.agents,x,y,r,pred);
// Alive mobs within r tiles of (x,y), id-ascending.
export const nearMobs=(x,y,r,pred)=>query(MG,S.mobs,x,y,r,pred);
// #730: the closest living hero strictly within r of (x,y) for which pred(e) holds, ties to the lowest id: exactly
// what walking nearHeroes(x,y,r) in id order and keeping the first strictly smaller distance (bd starting at r) picks,
// without building the list. The distance is within()'s Math.hypot(x-e.x,y-e.y), the value dist({x,y},e) gives.
export function nearestHero(x,y,r,pred){spatialStats.queries++;let best=null,bd=r;
  const take=e=>{spatialStats.candidates++;const dx=x-e.x;if(dx>r||dx<-r)return;const dy=y-e.y;if(dy>r||dy<-r)return;
    if(!pred(e))return;const d=Math.hypot(dx,dy);if(d<bd||(d===bd&&best&&e.id<best.id)){bd=d;best=e}};
  if(!USE_INDEX){for(const e of S.agents)take(e);return best}
  const x0=cx(x-r-SLACK),x1=cx(x+r+SLACK),y0=cy(y-r-SLACK),y1=cy(y+r+SLACK);
  for(let j=y0;j<=y1;j++)for(let i=x0;i<=x1;i++){const c=HG.cells[j*CW+i],n=HG.n[j*CW+i];for(let k=0;k<n;k++)take(c[k])}
  return best}
// Heroes then mobs, each id-ascending.
export const nearAll=(x,y,r,pred)=>nearHeroes(x,y,r,pred).concat(nearMobs(x,y,r,pred));

// #730: a second hero grid taken on demand (snapHeroes), for a pass that runs late in step() and moves no hero: the
// residents' greetings in npcsTick. The step grid above was built before the heroes acted and misses heroes made mid-step,
// so such a pass cannot use it (see the note on npcs.js greet); this one is taken when the pass starts, from every hero
// in S.agents (dead ones too: callers keep all their own filters). heroesAround(x,y,r) then returns exactly the heroes a
// walk over S.agents with within(a,{x,y},r) would accept, in S.agents order (id-ascending), using current positions;
// cells are scanned SLACK beyond r all the same. Module-level scratch only, never on S.
let SG=grid(),snapOn=false;
// Another map (#1013): another size, so new grids. They hold nothing but this step's scratch.
onWorld(()=>{CW=Math.ceil(W/CELL)+1;CH=Math.ceil(H/CELL)+1;spatialStats.cells=CW*CH;HG=grid();MG=grid();SG=grid();snapOn=false},()=>({spatial:[CW,CH,spatialStats.cells,HG.n.length,MG.n.length,SG.n.length]}));
export function snapHeroes(){SG.clear();for(const a of S.agents)SG.add(a);snapOn=true}
export const dropSnap=()=>{snapOn=false};
export function heroesAround(x,y,r){P.x=x;P.y=y;const out=[];
  if(!snapOn||!USE_INDEX){for(const a of S.agents)if(within(a,P,r))out.push(a);return out}
  const x0=cx(x-r-SLACK),x1=cx(x+r+SLACK),y0=cy(y-r-SLACK),y1=cy(y+r+SLACK);
  for(let j=y0;j<=y1;j++)for(let i=x0;i<=x1;i++){const c=SG.cells[j*CW+i],n=SG.n[j*CW+i];for(let k=0;k<n;k++)if(within(c[k],P,r))out.push(c[k])}
  if(out.length>1)out.sort(byId);return out}

// #433 level of detail, OFF by default: it changes results (mob wander draws from the gameplay RNG, greeting
// rolls move to other steps), so seeded worlds only match main with it off. On (setLod(true), or
// ELDMOOR_LOD=1 in Node): an idle mob with no living hero within SLEEP_R tiles' cells sleeps (heals, does not
// wander or scan), and townsfolk look for someone to greet on one step in GREET_EVERY (staggered by id).
export const LOD={on:typeof process!=='undefined'&&!!(process.env&&process.env.ELDMOOR_LOD==='1'),SLEEP_R:12,GREET_EVERY:6,tick:0};
export const setLod=on=>{LOD.on=!!on};
// Any living hero indexed in a cell within r tiles of (x,y) (cells only, no distance test: a cheap "is anyone about").
export function heroCellsNear(x,y,r){const x0=cx(x-r),x1=cx(x+r),y0=cy(y-r),y1=cy(y+r);
  for(let j=y0;j<=y1;j++)for(let i=x0;i<=x1;i++)if(HG.n[j*CW+i])return true;return false}
