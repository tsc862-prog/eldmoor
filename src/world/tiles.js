// Map dimensions, tile ids and per-tile movement speed. Owned by world-builder.
// W and H are live bindings: they take the size of the active world spec (spec.js) when this
// module loads, before anything else can read them, and map.js confirms them with setWorldSize.
import {ACTIVE_SPEC} from './spec.js';
export let W=ACTIVE_SPEC.size.w,H=ACTIVE_SPEC.size.h;
export const T=16;
export function setWorldSize(w,h){W=w;H=h}
export const G=0,TREE=1,SWAMP=2,MUD=3,ROCK=4,PEAK=5,LAVA=6,ROAD=7,FLOOR=8,WALL=9,RIVER=10,BRIDGE=11,SGRASS=12,FLOWER=13,SNOW=14,ICE=15;
export const SPEED=[1,.75,.5,.7,.9,.6,.6,1.3,1.1,1,.55,1.2,.9,1,.9,1.15];
// Tiles heroes and monsters may be placed on when picking hunting spots.
export const WALKABLE=[G,TREE,FLOWER,SGRASS,MUD,ROCK,PEAK,ROAD,SNOW,ICE];
