// The world's own words (#1003): the names that templates in src/data and src/sim fill in, so what heroes and the DM read
// names the places of the world they stand in, not Eldmoor's. Built once from the map, like the map itself (the world is chosen
// once per process); on Eldmoor every entry equals the word the templates used to carry. Owned by world-builder.
import {ZONES,REGIONS,CITY,CRYPTS,LAIR,zoneAt} from './map.js';
import {ACTIVE_SPEC} from './spec.js';

const the=n=>String(n).replace(/^The /,'the ');
const firstTown=f=>(CITY.find(c=>c.fac===f)||CITY[0]).name;
const far=REGIONS.findIndex(r=>r.far);
export const WORDS={
  world:the(ACTIVE_SPEC.name),            // 'Eldmoor', 'the Wending Vale'
  crypt:the(CRYPTS[0].name),              // the first dungeon: 'the Sunken Crypt', 'the Drowned Weir'
  cryptName:CRYPTS[0].name,
  cryptRegion:ZONES[zoneAt(CRYPTS[0].x,CRYPTS[0].y)]||ZONES[ZONES.length-1],
  lairRegion:ZONES[zoneAt(LAIR.x,LAIR.y)]||ZONES[ZONES.length-1],
  farRegion:ZONES[far>=0?far:ZONES.length-1], // the world's far region (the spec's far flag, else the last)
  midRegion:ZONES[1]||ZONES[0],
  lowRegion:ZONES[0],                     // the gentlest region: the peaceful vale where no duels are fought
  town:f=>firstTown(f),                   // a faction's first town
};
// Fill {world} {crypt} {cryptRegion} {lairRegion} {farRegion} {lowRegion} {town0} {town1} in a template; other braces are left alone.
export const worldFill=t=>String(t).replace(/\{(world|crypt|cryptRegion|lairRegion|farRegion|lowRegion|town\d)\}/g,(m,k)=>/^town/.test(k)?WORDS.town(+k.slice(4)):WORDS[k]);
