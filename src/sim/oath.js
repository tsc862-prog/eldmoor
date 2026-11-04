// Oaths and offered threads, the reading side (#800). Owned by ai-designer. A leaf: no sim module but state, so anything may
// import it. No RNG, nothing here changes the world. The writing side is sim/sworn.js.
//
// The game still rolls every hero's goal (a.goal, sim/goals.js). For a scripted hero that is its oath. For an agent-played hero it
// is an offered thread until the hero swears it aloud: the past is given, the oath is chosen.
//   g.offered   true: not sworn. Nobody speaks of it as an oath. A goal without it is sworn (so a save from before #800 keeps its
//               oaths, and every scripted hero reads as it always did).
//   g.offeredAt the game minute it was offered.
//   g.quiet     the one offer is over (the first dusk asked again): the header stops naming it; self and the quest log keep it.
//   g.aside     set aside, or rolled behind the scenes after an oath ended: read by nobody. The goal only keeps the world's dice.
//   g.sworn     {at, by, heard:[ids], words}: sworn in play. words: true when g.text is the hero's own.
// Hero-sworn goals that the game cannot match to a type have type 'own' and g.kind/g.about, as a vow's (sim/vows.js).
import {S} from './state.js';
import {ZONES} from '../world/map.js';
import {FAC} from '../data/factions.js';
import {THREAD_TEXT} from '../data/origins.js';

export const OATH={ASK_MIN:2880}; // game minutes the header names an unanswered thread, for a runner that never reflects

const fill=(t,v)=>t.replace(/\{(\w+)\}/g,(m,k)=>v[k]!==undefined&&v[k]!==null?String(v[k]):'someone');
const low=t=>String(t).charAt(0).toLowerCase()+String(t).slice(1);

// The oath this hero really holds, or null. Everything that speaks of an oath reads this, never a.goal.
export const swornOf=a=>{const g=a&&a.goal;return g&&!g.done&&!g.offered?g:null};
// The thread still in front of the hero (its own header, self, the quest log, the DM), or null.
export const threadOf=a=>{const g=a&&a.goal;return g&&!g.done&&g.offered&&!g.aside?g:null};
// The offer is still open: the turn header names it.
export const askOpen=a=>{const g=threadOf(a);return !!(g&&!g.quiet&&S.gameMin-(g.offeredAt||0)<OATH.ASK_MIN)};
// The thread in words, as the past. '' when there is none.
export function threadText(a,g=threadOf(a)){if(!g)return '';const t=THREAD_TEXT[g.type];if(!t)return '';
  return fill(t,{name:a.name,target:g.target,victim:g.victim,zone:typeof g.zone==='number'?ZONES[g.zone]:g.zone,fac:g.targetFac!=null&&FAC[g.targetFac]?FAC[g.targetFac].name:null})}
// A sworn oath in the narrator's mouth: the hero's own words as they said them, else the plain oath.
export function oathSaid(a,g=swornOf(a)){if(!g)return '';const t=String(g.text).replace(/[.!?]+$/,'');
  return g.sworn&&g.sworn.words?a.name+' has sworn: "'+t+'"':a.name+' has sworn to '+low(t)}
// Offered to the hero the moment it becomes agent-played (sim/player.js markPlayer). A goal already sworn stays sworn.
export function offerThread(a){const g=a.goal;if(!g||g.done||g.sworn||g.offered!==undefined)return;g.offered=true;g.offeredAt=Math.round(S.gameMin)}
// Handed back to the scripted rules: the goal is its oath again.
export function withdrawThread(a){const g=a.goal;if(!g||!g.offered)return;delete g.offered;delete g.offeredAt;delete g.quiet;delete g.aside}

// A recruit made for an agent seat: the chronicle's "swears to ..." line is not said for them. The die is still rolled.
let hush=0;
export const hushed=()=>hush>0;
export function hushOath(f){hush++;try{return f()}finally{hush--}}
