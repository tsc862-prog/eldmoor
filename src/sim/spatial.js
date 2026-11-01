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

export const CELL=4,SLACK=1.5;
const CW=Math.ceil(W/CELL)+1,CH=Math.ceil(H/CELL)+1; // +1 so a position exactly at W or H still has a cell
const heroCells=[],mobCells=[],usedH=[],usedM=[]; // used*: indices of the cells filled by the last rebuild
for(let i=0;i<CW*CH;i++){heroCells.push([]);mobCells.push([])}

export let USE_INDEX=true;
export const setIndex=on=>{USE_INDEX=!!on};

// Counters for the headless report: entities indexed at the last rebuild, queries and
// candidates (entities inspected after the cell pass) since the start, and rebuild count.
export const spatialStats={cells:CW*CH,heroes:0,mobs:0,queries:0,candidates:0,rebuilds:0};

const cx=x=>{const c=Math.floor(x/CELL);return c<0?0:c>=CW?CW-1:c};
const cy=y=>{const c=Math.floor(y/CELL);return c<0?0:c>=CH?CH-1:c};

export function rebuild(){
  for(const i of usedH)heroCells[i].length=0;for(const i of usedM)mobCells[i].length=0;usedH.length=0;usedM.length=0;
  let nh=0,nm=0;
  for(const a of S.agents){if(a.state==='dead')continue;const i=cy(a.y)*CW+cx(a.x),c=heroCells[i];if(!c.length)usedH.push(i);c.push(a);nh++}
  for(const m of S.mobs){if(!m.alive||m.gone)continue;const i=cy(m.y)*CW+cx(m.x),c=mobCells[i];if(!c.length)usedM.push(i);c.push(m);nm++}
  spatialStats.heroes=nh;spatialStats.mobs=nm;spatialStats.rebuilds++}

const P={x:0,y:0};
const byId=(a,b)=>a.id-b.id;
function query(cells,all,x,y,r,pred){spatialStats.queries++;P.x=x;P.y=y;const out=[];
  if(!USE_INDEX){for(const e of all){spatialStats.candidates++;if((!pred||pred(e))&&dist(P,e)<=r)out.push(e)}return out}
  const x0=cx(x-r-SLACK),x1=cx(x+r+SLACK),y0=cy(y-r-SLACK),y1=cy(y+r+SLACK);
  for(let j=y0;j<=y1;j++)for(let i=x0;i<=x1;i++){const c=cells[j*CW+i];
    for(let k=0;k<c.length;k++){const e=c[k];spatialStats.candidates++;if((!pred||pred(e))&&dist(P,e)<=r)out.push(e)}}
  if(out.length>1)out.sort(byId);return out}

// Living heroes within r tiles of (x,y), id-ascending. pred(e) is an optional extra filter.
export const nearHeroes=(x,y,r,pred)=>query(heroCells,S.agents,x,y,r,pred);
// Alive mobs within r tiles of (x,y), id-ascending.
export const nearMobs=(x,y,r,pred)=>query(mobCells,S.mobs,x,y,r,pred);
// Heroes then mobs, each id-ascending.
export const nearAll=(x,y,r,pred)=>nearHeroes(x,y,r,pred).concat(nearMobs(x,y,r,pred));
