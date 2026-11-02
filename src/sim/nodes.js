// Gathering node state (issue #255, epic #238). Where the nodes are is world data (world/nodes.js, NODES in map.js);
// this file keeps only which of them are spent. S.nodes = {world, ready:{[nodeId]: gameMin when it is ready again}},
// plain data, created on the first harvest (so a world nobody gathers in carries nothing, and the seeded run is
// untouched), saved with the world by the generic S walk, and reset when a new world instance starts (worldId).
// Respawn needs no tick: a node is ready when the game clock has passed its time. Nothing here draws from the RNG.
// Gathering itself (who, when, what comes out) is #257; this is the registry it calls.
//   isReady(node)        -> boolean
//   readyAt(node)        -> game minute it is ready again (0 when ready now)
//   harvest(node)        -> {ok:true, readyAt} | {ok:false, why, readyAt?}; spends the node until it respawns
//   availableNodes(zone, kind?) / availableNear(x, y, r, kind?) -> ready nodes only
import {S} from './state.js';
import {NODES,nodeById,nodesIn,nodeNear} from '../world/map.js';

export {NODES,nodeById,nodesIn,nodeNear};

function ensure(){
  if(!S.nodes||S.nodes.world!==S.worldId||typeof S.nodes.ready!=='object')S.nodes={world:S.worldId,ready:{}};
  return S.nodes}
const resolve=n=>typeof n==='string'?nodeById(n):n;

export const readyAt=node=>{const n=resolve(node);if(!n||!S.nodes||S.nodes.world!==S.worldId)return 0;
  const t=S.nodes.ready[n.id];return t!==undefined&&t>S.gameMin?t:0};
export const isReady=node=>{const n=resolve(node);return !!n&&readyAt(n)===0};

export function harvest(node){
  const n=resolve(node);if(!n)return{ok:false,why:'no such node'};
  const t=readyAt(n);if(t)return{ok:false,why:n.name+' is spent until it grows back',readyAt:t};
  const st=ensure();
  for(const id in st.ready)if(st.ready[id]<=S.gameMin)delete st.ready[id]; // forget the grown-back
  st.ready[n.id]=Math.round((S.gameMin+n.respawn)*1000)/1000;
  return{ok:true,readyAt:st.ready[n.id]}}

export const availableNodes=(zone,kind)=>nodesIn(zone,kind).filter(isReady);
export const availableNear=(x,y,r,kind)=>nodeNear(x,y,r,kind).filter(isReady);
