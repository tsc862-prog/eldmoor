// The map: tile and zone arrays, zone boundaries, cities, roads, the river,
// the Sunken Crypt entrance, Kragmaw's lair, spawn points, lights and labels.
// Built once at import time from the ELDMOOR spec (spec.js) by the generator
// (gen.js). Everything other modules need is re-exported here under the names
// they have always used. Owned by world-builder.
import {W as TW,H as TH} from './tiles.js';
import {ELDMOOR} from './spec.js';
import {buildWorld} from './gen.js';

const WORLD=buildWorld(ELDMOOR);
if(WORLD.w!==TW||WORLD.h!==TH)throw new Error(`world spec ${ELDMOOR.name} is ${WORLD.w}x${WORLD.h} but tiles.js says ${TW}x${TH}`);

export const {tiles,zone,I,ZONES,REGIONS,CITY,LANDMARKS,LAIR,CRYPT,ZPTS,LIGHTS,LABELS,zoneFor,zoneAt,tileAt,zonePoint,road}=WORLD;
export const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);

// Compatibility: the three boundary curves by their old names. Prefer zoneAt.
export const riverX=WORLD.curves.river;
export const z2X=WORLD.curves.passEdge;
export const hoarY=WORLD.curves.frostEdge;
