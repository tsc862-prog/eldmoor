// Guild rivalries (issue #6, first slice). Owned by ai-designer. DOM-free, no RNG (the dice in
// pvp.js only get multiplied, so a world without rivalries rolls exactly as before).
//
// Two guilds of opposing factions build up "heat" from things that already happen in the world:
//   kill   a guilded hero slain by a member of another guild: RIV.KILL_VET when the fallen was a
//          veteran (level >= RIV.VET, the same line at which a death swears the whole guild,
//          GUILD_GRUDGE_LVL in heroes.js), RIV.KILL for a lesser death.
//   crypt  a guild clears the Sunken Crypt within RIV.CONTEST game minutes of an enemy guild's clear.
//   boss   a guild's raiders slay Kragmaw while an enemy guild's raiders are on the field, or within
//          RIV.CONTEST of that guild's own kill.
// Heat halves every RIV.HALF game days and is capped at RIV.CAP. At RIV.DECLARE the guilds declare
// a rivalry (chronicle and timeline); it ends when heat cools below RIV.END or a guild disbands.
// A declared rivalry multiplies the chance-duel odds between their members by RIV.DUEL and a
// guildmate's assist odds against a rival by RIV.ASSIST (both fixed, so the effect is bounded).
//
// The Fellowship stays out by default: a death, kill or clear that involves a Fellowship member adds
// no heat, a guild with a living Fellowship member is never part of a rivalry, and the odds never
// change for a duel or assist that touches a member.
//
// State (lazy, saved with the world): S.rivals = {heat:{'lo:hi':n}, on:{'lo:hi':{since,why}},
// last:{'crypt:gid'|'boss:gid':gameMin}, t, stats:{declared,ended,duels,assists,heat:{kind:events}}}; keys are guild ids.
import {S} from './state.js';
import {log} from './chronicle.js';
import {timeline} from './history.js';
import {inSlots} from './company.js'; // the slotted company (#588)
import {WORDS} from '../world/words.js';

export const RIV={VET:12,KILL_VET:2.5,KILL:1,CRYPT:1,BOSS:1.5,CONTEST:1440,DECLARE:3.5,END:1,CAP:8,HALF:2,DUEL:1.6,ASSIST:1.5,TICK:30};

const R=()=>S.rivals||(S.rivals={heat:{},on:{},last:{},t:S.gameMin,stats:{declared:0,ended:0,duels:0,assists:0,heat:{}}});
const key=(g,h)=>g.id<h.id?g.id+':'+h.id:h.id+':'+g.id;
const tagTxt=g=>({t:'<'+g.tag+'> '+g.name,c:'f'+g.fac});
const live=g=>g&&!g.retired;
const hasFellow=g=>S.agents.some(a=>a.guild===g&&inSlots(a)&&a.state!=='dead');
const byId=id=>S.GUILDS.find(g=>g.id===Number(id));

function heat(g,h,n,why,kind){
  if(!live(g)||!live(h)||g===h||g.fac===h.fac||hasFellow(g)||hasFellow(h))return;
  const r=R(),k=key(g,h),hs=r.stats.heat||(r.stats.heat={});hs[kind]=(hs[kind]||0)+1;r.heat[k]=Math.min(RIV.CAP,(r.heat[k]||0)+n);
  if(r.on[k]||r.heat[k]<RIV.DECLARE)return;
  r.on[k]={since:S.gameMin,why};r.stats.declared++;
  log(tagTxt(g),' and ',tagTxt(h),' declare a rivalry: ',why,'.');
  timeline('rival',tagTxt(g),' and ',tagTxt(h),' declare a rivalry.')}

// Called when a hero is slain by another hero (bonds.js inheritGrudge, from agentDie), before the grave.
export function rivalKill(victim,killer){
  if(!victim||!killer||killer.kind!=='hero'||!victim.guild||!killer.guild||inSlots(victim)||inSlots(killer))return;
  const vet=victim.lvl>=RIV.VET;
  heat(victim.guild,killer.guild,vet?RIV.KILL_VET:RIV.KILL,vet?killer.name+' cut down the veteran '+victim.name:'blood spilled between them',vet?'vet':'kill')}

// A guild finished something worth contesting: kind 'crypt' (a clear) or 'boss' (Kragmaw slain).
// others: guilds of the other side present at the deed (Kragmaw's losing raiders), if any.
export function rivalDeed(kind,g,others){
  if(!live(g))return;const r=R(),amt=kind==='boss'?RIV.BOSS:RIV.CRYPT;
  const what=kind==='boss'?'both lay claim to Kragmaw':'both stake their name on '+WORDS.crypt;
  const seen=new Set();
  for(const h of others||[]){if(seen.has(h))continue;seen.add(h);heat(g,h,amt,'they fought over Kragmaw',kind)}
  for(const k in r.last){const [kd,id]=k.split(':');if(kd!==kind)continue;const h=byId(id);
    if(!h||seen.has(h)||S.gameMin-r.last[k]>RIV.CONTEST)continue;seen.add(h);heat(g,h,amt,what,kind)}
  r.last[kind+':'+g.id]=S.gameMin}

// Is this pair of guilds in a declared rivalry?
export function rivals(g,h){return !!(g&&h&&g!==h&&S.rivals&&S.rivals.on[key(g,h)])}
// The odds multiplier for a duel ('duel') or an assist ('assist') between heroes a and b; 1 when no rivalry applies.
export function rivalMul(a,b,kind){
  if(!a||!b||inSlots(a)||inSlots(b)||!rivals(a.guild,b.guild))return 1;
  return kind==='assist'?RIV.ASSIST:RIV.DUEL}
// pvp.js counts the duels and assists a rivalry started (for the sim summary).
export function rivalCount(kind){R().stats[kind]++}
// The declared rivals of guild g, as guild objects (for the guild panel).
export function rivalsOf(g){const out=[];if(!S.rivals||!g)return out;
  for(const k in S.rivals.on){const [x,y]=k.split(':').map(Number);if(x!==g.id&&y!==g.id)continue;const h=byId(x===g.id?y:x);if(h)out.push(h)}
  return out}

// Decay and endings, every RIV.TICK game minutes (from guildsTick's caller in index.js).
export function rivalsTick(){
  if(!S.rivals)return;const r=S.rivals,dt=S.gameMin-r.t;if(dt<RIV.TICK)return;r.t=S.gameMin;
  const f=Math.pow(.5,dt/(RIV.HALF*1440));
  for(const k in r.heat){r.heat[k]*=f;
    const [g,h]=k.split(':').map(byId),gone=!live(g)||!live(h);
    if(r.on[k]&&(gone||r.heat[k]<RIV.END||hasFellow(g)||hasFellow(h))){delete r.on[k];r.stats.ended++;
      if(g&&h)log(tagTxt(g),' and ',tagTxt(h),gone?' end their rivalry: '+(live(g)?h:g).name+' has disbanded.':' let their rivalry cool.')}
    if(!r.on[k]&&(gone||r.heat[k]<.05))delete r.heat[k]}
  for(const k in r.last)if(S.gameMin-r.last[k]>RIV.CONTEST)delete r.last[k]}
