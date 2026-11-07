// Roads that leave the map with nothing built behind them yet (#1013 slice 7a). A spec exit with to:{map:null, heard} is painted, named and walkable, but no
// crossing exists: an order to walk it is refused in words, a walk that happens to end on it is told the same, heroes have heard of it, and the DM sees it in `regions`.
// Reads the live EXITS, so a map with no such road (every world but a chapter map) answers nothing and costs nothing. No dice. Owned by world-builder.
import {EXITS} from '../world/map.js';

const plain=s=>String(s||'').toLowerCase().replace(/['’]/g,'').replace(/^\s*(?:to|towards?|along|up|down|onto|on)\s+/,'').replace(/^the\s+/,'').trim();
export const closedRoads=()=>EXITS.filter(e=>e.to&&e.to.map==null);
// The closed road an order names, or null.
export function closedRoad(target){const t=plain(target);if(!t)return null;return closedRoads().find(e=>t.includes(plain(e.name)))||null}
// The closed road whose end is at this spot, or null.
export const roadEndAt=p=>closedRoads().find(e=>Math.hypot(e.x-p.x,e.y-p.y)<=e.r)||null;
export const roadWords=e=>e.name.charAt(0).toUpperCase()+e.name.slice(1)+' runs on past the last milestone, toward '+e.to.heard+'. Nobody here has walked it, and the way is not yet open.';
