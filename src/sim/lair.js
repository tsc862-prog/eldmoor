// The lair of the live map (#1013): a map may have none. Read here and nowhere else, as crypts.js reads the dungeons; nothing
// outside this file dereferences LAIR (npm run rulescheck counts what does). A map with no lair keeps a dormant S.boss (state.js).
// A leaf: world tables only, so state.js and any sim, render or ui module may import it. No dice.
import {LAIR,ZONES,zoneAt,dist} from '../world/map.js';

export const NO_LAIR='No great beast keeps a lair on this land: there is nothing here to raid. Look to the town board (list_jobs).';
export const hasLair=()=>!!LAIR;
export const nearLair=(p,r)=>!!LAIR&&dist(p,LAIR)<r;
export const lairSpot=()=>LAIR?{x:LAIR.x,y:LAIR.y}:null;
export const lairRegion=()=>LAIR?ZONES[zoneAt(LAIR.x,LAIR.y)]:null;
