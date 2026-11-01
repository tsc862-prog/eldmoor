// Factions and guild roster. Owned by character-builder. Peoples, skin and hair
// palettes and name syllables live in races.js; genName(f) stays as a wrapper.
import {pickA} from '../core/rng.js';
import {RACES,racesOf,raceName} from './races.js';

export const FAC=[{name:'Concord',color:'#5b8ff2',dark:'#2a4fa0'},
                  {name:'Warband',color:'#e8544a',dark:'#8a2420'}];
// Legacy palette: every skin tone of the faction's peoples (makeHero's first roll, before assignRace).
FAC.forEach((f,i)=>{f.skin=racesOf(i).flatMap(r=>r.skin)});
export const GUILD_DEFS=[{name:'Silver Vow',tag:'SV',fac:0},{name:'Dawnriders',tag:'DR',fac:0},{name:'Bloodfang',tag:'BF',fac:1},{name:'Ashen Fist',tag:'AF',fac:1}];

// A name for a hero of faction f from a random people of that faction. assignRace(a)
// re-rolls it from the hero's own people; this stays for callers that only know the faction.
export function genName(f){const rs=racesOf(f);return raceName(rs.length?pickA(rs):RACES[0])}
