// The map: tile and zone arrays, zone boundaries, cities, roads, the river,
// the Sunken Crypt entrance, Kragmaw's lair, spawn points, lights and labels.
// Built once at import time from the ELDMOOR spec (spec.js) by the generator
// (gen.js). Everything other modules need is re-exported here under the names
// they have always used. Owned by world-builder.
import {setWorldSize} from './tiles.js';
import {ACTIVE_SPEC,WORLD_ID,MAPS} from './spec.js';
import {fireWorld} from '../sim/kept.js'; // a sim leaf; the hook list for modules that captured map data (#1013)
import {buildWorld} from './gen.js';
import {indexNodes} from './nodes.js';
import {applyFauna} from '../data/fauna.js';

// The world is chosen once (spec.js: ?world= in the browser, ELDMOOR_WORLD in Node). tiles.js already
// holds its size; setWorldSize makes that explicit before anything is built from it.
const WORLD=buildWorld(ACTIVE_SPEC);
setWorldSize(WORLD.w,WORLD.h);
applyFauna(WORLD.REGIONS); // worlds with their own regions swap in region-keyed mob, elite and epic tables
export {WORLD_ID};

export let tiles,zone,I,ZONES,REGIONS,CITY,LANDMARKS,LAIR,CRYPT,CRYPTS,ZPTS,LIGHTS,LABELS,zoneFor,zoneAt,tileAt,zonePoint,road,OUTPOSTS,solid,land,mainLand,EXITS;
export const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);

// Compatibility: the three boundary curves by their old names. Prefer zoneAt.
export let riverX,z2X,hoarY;

// Gathering nodes (#255): placed by the generator from spec.nodes; lookups over them.
export let NODES,nodeById,nodesIn,nodeNear;

// The map on screen (#1013). WORLD_ID is the campaign (the starter map's id); MAP_ID names the map the bindings above hold. A
// single-map world never calls setWorld and keeps MAP_ID===WORLD_ID. All the bindings are live: importers read them at call time.
export let MAP_ID=WORLD_ID;
function bind(W){
  ({tiles,zone,I,ZONES,REGIONS,CITY,LANDMARKS,LAIR,CRYPT,CRYPTS,ZPTS,LIGHTS,LABELS,zoneFor,zoneAt,tileAt,zonePoint,road,OUTPOSTS,solid,land,mainLand}=W);
  EXITS=W.EXITS;
  riverX=W.curves.river;z2X=W.curves.passEdge;hoarY=W.curves.frostEdge;
  NODES=W.NODES;({nodeById,nodesIn,nodeNear}=indexNodes(NODES,W.w,W.h));
}
bind(WORLD);
// Switch the live map. Rebuilds the spec's world, rebinds every name above and the size in tiles.js, then fires the onWorld hooks.
// (Fauna tables are not re-applied here: applyFauna keeps no pristine stock yet, slice 1b.)
export function setWorld(mapId){
  const spec=MAPS[mapId];if(!spec)throw new Error('setWorld: no map '+mapId);
  if(mapId===MAP_ID)return false;
  const W=buildWorld(spec);setWorldSize(W.w,W.h);bind(W);MAP_ID=mapId;fireWorld(mapId);return true}
