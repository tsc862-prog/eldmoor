// The map: tile and zone arrays, zone boundaries, cities, roads, the river,
// the Sunken Crypt entrance, Kragmaw's lair, spawn points, lights and labels.
// Built once at import time from the ELDMOOR spec (spec.js) by the generator
// (gen.js). Everything other modules need is re-exported here under the names
// they have always used. Owned by world-builder.
import {setWorldSize} from './tiles.js';
import {ACTIVE_SPEC,WORLD_ID} from './spec.js';
import {buildWorld} from './gen.js';
import {indexNodes} from './nodes.js';
import {applyFauna} from '../data/fauna.js';

// The world is chosen once (spec.js: ?world= in the browser, ELDMOOR_WORLD in Node). tiles.js already
// holds its size; setWorldSize makes that explicit before anything is built from it.
const WORLD=buildWorld(ACTIVE_SPEC);
setWorldSize(WORLD.w,WORLD.h);
applyFauna(WORLD.REGIONS); // worlds with their own regions swap in region-keyed mob, elite and epic tables
export {WORLD_ID};

export const {tiles,zone,I,ZONES,REGIONS,CITY,LANDMARKS,LAIR,CRYPT,CRYPTS,ZPTS,LIGHTS,LABELS,zoneFor,zoneAt,tileAt,zonePoint,road,OUTPOSTS,solid,land,mainLand}=WORLD;
export const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);

// Compatibility: the three boundary curves by their old names. Prefer zoneAt.
export const riverX=WORLD.curves.river;
export const z2X=WORLD.curves.passEdge;
export const hoarY=WORLD.curves.frostEdge;

// Gathering nodes (#255): placed by the generator from spec.nodes; lookups over them.
export const NODES=WORLD.NODES;
export const {nodeById,nodesIn,nodeNear}=indexNodes(NODES,WORLD.w,WORLD.h);
