// Timed effects on any combatant (issue #81) and the passives a hero's class has earned. Tiny and
// import-light on purpose: sim/stats.js (damage taken) and sim/heroes.js (strike) read it, and the
// resolver that applies abilities is sim/moves.js. Owned by character-builder.
//
// e.eff[key] = {v, u, r}: value, real-time expiry in sim seconds (S.gameMin / 6; the clock stops with the
// world), and rounds left (Table combat). An effect holds while either is still running. Plain data, so a
// save keeps it. Keys: taken (damage-taken multiplier on e), mark (damage-taken multiplier from any attacker).
import {S} from './state.js';
import {PASSIVES,CLASS_PASSIVES,SPEC_PASSIVES} from '../data/moves.js';
import {SPECS} from '../data/classes.js';

const now=()=>S.gameMin/6;
export function setEff(e,key,v,dur,durR,round){(e.eff||(e.eff={}))[key]=round?{v,u:0,r:durR||1}:{v,u:now()+(dur||0),r:0}}
export const effOn=(e,key)=>{const f=e&&e.eff&&e.eff[key];return !!f&&(f.u>now()||f.r>0)};
export const effMul=(e,key)=>effOn(e,key)?e.eff[key].v:1;
export const effLeft=(e,key)=>{const f=e&&e.eff&&e.eff[key];return f&&f.u>now()?Math.round((f.u-now())*10)/10:0};
// A round passed at the Table: effects counted in rounds run down.
export function eachRound(e){if(!e||!e.eff)return;for(const k in e.eff){const f=e.eff[k];if(f.r>0)f.r--}}

// Passives learned so far (a hero's class and level).
// A chosen specialisation (a.spec, issue #82) adds its own passives; a spec of another class is ignored.
export const passivesOf=a=>{const L=a.lvl||1,sp=a.spec&&SPECS[a.spec]&&SPECS[a.spec].cls===a.cls?SPEC_PASSIVES[a.spec]||[]:[];
  return [...(CLASS_PASSIVES[a.cls]||[]),...sp].filter(id=>PASSIVES[id].lvl<=L)};
export function passiveSum(a,key){let t=0;for(const id of passivesOf(a)){const v=PASSIVES[id][key];if(typeof v==='number')t+=v}return t}
export function passiveMul(a,key){let t=1;for(const id of passivesOf(a)){const v=PASSIVES[id][key];if(typeof v==='number')t*=v}return t}
// Blows on this hero: the plain passive, and the one that wakes under a health share.
export function passiveTaken(a,frac){let t=passiveMul(a,'taken');
  for(const id of passivesOf(a)){const b=PASSIVES[id].takenBelow;if(b&&frac<b.hp)t*=b.mul}return t}
