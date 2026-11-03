// Per-hero event log for the dossier Log tab (issue #19). record(a, ...parts) pushes
// {t, parts, text} onto a.history, newest last, capped at HIST_CAP. Parts follow the
// chronicle convention: strings, heroes (the UI renders them as clickable names) or
// {t, c} spans. Pure bookkeeping: it rolls no random numbers and changes no behaviour.
import {S,clockStr,dayNo} from './state.js';

export const HIST_CAP=40,TL_CAP=200;
// Observers read a hero's log lines: sim/company.js (the slots option, #68/#588) turns a member's into memories, sim/tiers.js (#153)
// keeps an agent hero's landmarks. They read only.
const hooks=[];export const onRecord=f=>{hooks.push(f)};
// Who caused a line (issue #136): 'agent' (the agent's order), 'autopilot' (carrying the last order out
// while the agent is silent), 'reflex' (the hero's own nerve: a flee, a potion, going home with a full bag),
// 'ai' (a model-played hero) or 'scripted'. asSrc(src, fn) forces it for what fn records.
let forced=null;
export function asSrc(src,fn){const o=forced;forced=src;try{return fn()}finally{forced=o}}
export const srcOf=a=>forced||(a.player?(a.playIdle?'autopilot':'agent'):a.brain?'ai':'scripted');
export function record(a,...parts){if(!a)return;
  const text=parts.map(p=>typeof p==='string'?p:p.kind==='hero'?p.name:p.t).join('');
  (a.history||(a.history=[])).push({t:clockStr(),d:dayNo(),src:srcOf(a),parts,text});
  if(a.history.length>HIST_CAP)a.history.shift();
  for(const h of hooks)h(a,text)}

// World timeline: notable events for the Timeline panel. timeline(kind, ...parts) puts
// {t, gameMin, kind, parts} on S.timeline, newest first, capped at TL_CAP. kind is one of
// boss, raid, crypt, level, death, elite, oath. first(key) is true once per key, so
// "first to level 10" style milestones fire a single time (S.tlFirsts survives saves).
export function timeline(kind,...parts){
  const tl=S.timeline||(S.timeline=[]);
  tl.unshift({t:clockStr(),gameMin:S.gameMin,kind,parts});
  if(tl.length>TL_CAP)tl.pop()}
export function first(key){const f=S.tlFirsts||(S.tlFirsts={});if(f[key])return false;f[key]=1;return true}
