// The solid-ground layer (#792, slice 1 of the solid-world epic #791). Owned by world-builder.
// solidAt(x,y) says whether a tile cannot be stood on or walked through, nearestOpen(x,y) names the closest tile that can.
// The grid itself is built per world by gen.js (solidgrid.js holds what is solid and why); this is the one reader.
// moveTo (sim/path.js, #794) and the placement of everything in the world read it. WALKABLE keeps its meaning.
import {solid,land,mainLand,I} from './map.js';
import {W,H} from './tiles.js';
import {WHY} from './solidgrid.js';
export {SOLID_TILES,FOREST_CORE,NEST_CORE} from './solidgrid.js';

const grid=()=>solid;
const inb=(x,y)=>x>=0&&y>=0&&x<W&&y<H;
// True when the tile at (x,y) (world units, floored) cannot be stood on or walked through. Off the map is solid.
export function solidAt(x,y){const tx=Math.floor(x),ty=Math.floor(y);return !inb(tx,ty)||grid()[I(tx,ty)]!==0}
// Why a tile is solid: 'wall' | 'river' | 'peak' | 'lava' | 'building' | 'rock' | 'forest', or null when open.
export function solidWhy(x,y){const tx=Math.floor(x),ty=Math.floor(y);if(!inb(tx,ty))return 'off the map';const c=grid()[I(tx,ty)];return c?WHY[c]:null}
// The nearest open tile centre to (x,y), searching outward by rings up to maxR tiles (default 12).
// ok(p) is an optional extra test (the levers pass their own rules). Returns {x,y} or null.
export function nearestOpen(x,y,maxR=12,ok){const cx=Math.floor(x),cy=Math.floor(y);let best=null,bd=Infinity;
  for(let r=0;r<=maxR;r++){
    if(best&&r>bd+1)break; // a ring can no longer beat the best found
    for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){if(Math.max(Math.abs(dx),Math.abs(dy))!==r)continue;
      const tx=cx+dx,ty=cy+dy;if(!inb(tx,ty)||grid()[I(tx,ty)]!==0)continue;
      const p={x:tx+.5,y:ty+.5};if(ok&&!ok(p))continue;
      const d=Math.hypot(p.x-x,p.y-y);if(d<bd){bd=d;best=p}}}
  return best}
// Where to stand for a point that may fall on solid ground (a building's footprint when a hero is placed in a town
// at random, #793): the point itself when open, else the nearest open tile centre within maxR (default 4), else the point.
// No dice, so the callers' random draws stay as they were. Returns {x,y}.
export function standAt(x,y,maxR=4){if(!solidAt(x,y))return {x,y};const o=nearestOpen(x,y,maxR);return o||{x,y}}
// The land a point stands on (open tiles joined by legal steps), -1 on solid ground or off the map. Two points on one land can reach each other.
export function landAt(x,y){const tx=Math.floor(x),ty=Math.floor(y);return inb(tx,ty)?land[I(tx,ty)]:-1}
// True when the point is on the land the towns stand on, not a pocket shut in by peaks or trees.
export const onMainLand=(x,y)=>landAt(x,y)===mainLand;
// Count of solid tiles, by reason (for the world check and the survey note).
export function solidCounts(){const g=grid(),o={};for(let i=0;i<g.length;i++)if(g[i])o[WHY[g[i]]]=(o[WHY[g[i]]]||0)+1;return o}
