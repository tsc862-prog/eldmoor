// The world's own words (#1003): the names that templates in src/data and src/sim fill in, so what heroes and the DM read
// names the places of the world they stand in, not Eldmoor's. Built from the map, like the map itself; a switch of map builds
// them again (#1013) and `world`, the campaign's name, stays. On Eldmoor every entry equals the word the templates used to carry.
// A table of text built from these goes through worded(), which builds it again in place. Owned by world-builder.
import {ZONES,REGIONS,CITY,CRYPTS,LAIR,zoneAt} from './map.js';
import {ACTIVE_SPEC} from './spec.js';
import {onWorld} from '../sim/kept.js';

const the=n=>String(n).replace(/^The /,'the ');
const firstTown=f=>(CITY.find(c=>c.fac===f)||CITY[0]).name;
const lastZone=()=>ZONES[ZONES.length-1];
// A map with no dungeon or no lair keeps the words it was handed: the places are still out there, on a map the company left.
function mapWords(){const far=REGIONS.findIndex(r=>r.far),D=CRYPTS[0],o={
  world:the(ACTIVE_SPEC.name),            // 'Eldmoor', 'the Wending Vale': the campaign, whichever map is live
  farRegion:ZONES[far>=0?far:ZONES.length-1], // the world's far region (the spec's far flag, else the last)
  midRegion:ZONES[1]||ZONES[0],
  lowRegion:ZONES[0],                     // the gentlest region: the peaceful vale where no duels are fought
  town:f=>firstTown(f),                   // a faction's first town
};
  if(D)Object.assign(o,{
    crypt:the(D.name),                    // the first dungeon: 'the Sunken Crypt', 'the Drowned Weir'
    cryptName:D.name,
    cryptRegion:ZONES[zoneAt(D.x,D.y)]||lastZone()});
  if(LAIR)o.lairRegion=ZONES[zoneAt(LAIR.x,LAIR.y)]||lastZone();
  return o}
export const WORDS=mapWords();
// Fill {world} {crypt} {cryptRegion} {lairRegion} {farRegion} {lowRegion} {town0} {town1} in a template; other braces are left alone.
export const worldFill=t=>String(t).replace(/\{(world|crypt|cryptRegion|lairRegion|farRegion|lowRegion|town\d)\}/g,(m,k)=>/^town/.test(k)?WORDS.town(+k.slice(4)):WORDS[k]);

// A table written with WORDS in its strings: worded(()=>table) builds it now and returns it, and a switch of map builds it again
// into the same objects, row by row, so whoever holds a row or the table keeps them.
const TABLES=[];
const into=(cur,next)=>{for(const k of Object.keys(next)){const c=cur[k],v=next[k];if(c===v)continue;if(c&&v&&typeof c==='object'&&typeof v==='object')into(c,v);else cur[k]=v}};
export const worded=build=>{const t=build();TABLES.push({t,build});return t};
onWorld(()=>{Object.assign(WORDS,mapWords());for(const {t,build} of TABLES)into(t,build())},
  ()=>({words:{...WORDS,town:CITY.map(c=>c.fac).filter((f,i,A)=>A.indexOf(f)===i).map(firstTown)},wordedTables:TABLES.map(x=>x.t)}));
