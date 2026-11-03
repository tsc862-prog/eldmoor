// The hero's stated aim (issue #535): an agent-played hero says, in its own words, what it is trying to do now.
//   a.intent = {goal, why, until, untilAt, set, prog, snap, order, done, n}
//     goal/why/until  the agent's words (until: a condition, or game hours read into untilAt)
//     set             game minute it was stated; prog: last game minute with progress toward it (a kill, XP, a level,
//                     INTENT.STEP tiles walked, the adventure's next scene); stale after INTENT.STALE without progress
//     order           what autopilot carries on for it, where the aim maps to one (sim/player.js): {kind:'move', label, to},
//                     {kind:'hunt', n, k0, prey?, ground?}, {kind:'follow', id, name}, {kind:'wait'}; null when it maps to none
//     done            {at, why} once kept, the time given is up, or the agent let it go; the aim is then read as "done"
//   a.intentSeq        aims stated so far (the behavior digest counts them per hero per game day)
//   a.heardAim         the last aim a company leader shouted in this hero's hearing: {id, name, text, at}
// Agent-played heroes only, no RNG, never part of a scripted hero's step: the seeded world is unchanged.
// Private to the hero (in-game channels, #123): only a leader's shout leaves it, as a party line heard in range.
import {S} from './state.js';
import {dist} from '../world/map.js';

export const INTENT={
  STALE:120,      // game minutes without progress before the aim is stale and the next turn asks again
  WAIT_DEF:120,   // a wait-like aim with no until ends after this many game minutes
  WAIT_NOAIM:120, // with no aim, the wait tool is held to this many game minutes
  NO_AIM:120,     // behavior: an agent hero with no aim this long outside camp or town rest -> no-aim anomaly
  GOAL:160,WHY:200,UNTIL:100,
  HOURS:[.25,72], // until in game hours, bounds
  PER_DAY:12,     // aims stated a game day
  STEP:4,         // tiles walked that count as progress
  NEAR:3,         // tiles from a move aim's place that count as there
  LEAD_AGE:720,   // game minutes a leader's shouted aim stays in a follower's header
};
const clean=(s,n)=>String(s==null?'':s).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,n);
const mins=m=>{m=Math.max(0,Math.round(m));return m<60?m+' min':Math.round(m/60*10)/10+' h'};
const snapOf=a=>({x:a.x,y:a.y,kills:a.kills||0,xp:a.xp||0,lvl:a.lvl,adv:a.adv||null,idx:advIdx(a)});
const advIdx=a=>{if(!a.adv||!S.adventures)return null;const v=S.adventures.find(x=>x.id===a.adv);return v?v.idx:null};
const WAITISH=/^(?:to\s+)?(?:wait|rest|camp|stay|hold|sit|sleep|keep watch|stand watch|linger|bide)\b/i;
export const waitish=g=>WAITISH.test(String(g||'').trim());

// until: a number or "3", "3h", "3 hours", "90 min", "1.5 hours" -> game minutes; anything else is a condition in words.
export function untilOf(u){if(u==null||u==='')return {text:null,at:null};
  if(typeof u==='number'&&Number.isFinite(u))return hoursAt(u,u+' h');
  const t=clean(u,INTENT.UNTIL);if(!t)return {text:null,at:null};
  const m=/^(?:for\s+|in\s+)?(\d+(?:\.\d+)?)\s*(h|hrs?|hours?|m|mins?|minutes?)?(?:\s+of\s+game\s+time)?$/i.exec(t);
  if(m){const v=Number(m[1]),unit=(m[2]||'h').toLowerCase();return hoursAt(unit.startsWith('m')?v/60:v,t)}
  return {text:t,at:null}}
function hoursAt(h,text){const v=Math.min(INTENT.HOURS[1],Math.max(INTENT.HOURS[0],Number(h)||1));return {text:String(text),at:Math.round(S.gameMin+v*60),hours:v}}

// State it (the tool, through sim/player.js, which maps the order). -> {ok, ...} or {ok:false, error}
export function setIntent(a,{goal,why,until}={},order=null){
  const g=clean(goal,INTENT.GOAL).replace(/^["“]|["”]$/g,'');if(!g)return {ok:false,error:'Say your aim: intent {goal: what you are trying to do now, why: the reason, until: hours or a condition (optional)}.'};
  const d=Math.floor(S.gameMin/1440),D=a.intentDay&&a.intentDay.d===d?a.intentDay:(a.intentDay={d,n:0});
  if(D.n>=INTENT.PER_DAY)return {ok:false,error:'You have changed your aim '+D.n+' times today. Keep to the one you have: '+(a.intent&&!a.intent.done?a.intent.goal:'none')+'.'};
  const w=clean(why,INTENT.WHY),u=untilOf(until),notes=[];
  if(!w)notes.push('Next time say why, in a few words: it keeps you to it.');
  if(u.at==null&&!u.text&&waitish(g)){Object.assign(u,hoursAt(INTENT.WAIT_DEF/60,null));notes.push('A wait needs a limit: you gave none, so this one ends in '+mins(INTENT.WAIT_DEF)+'.')}
  const prev=a.intent&&!a.intent.done?a.intent:null;
  D.n++;a.intentSeq=(a.intentSeq||0)+1;
  a.intent={goal:g,why:w,until:u.text,untilAt:u.at,set:Math.round(S.gameMin),prog:Math.round(S.gameMin),snap:snapOf(a),order:order||null,done:null,n:a.intentSeq};
  return {ok:true,aim:aimLine(a),was:prev?prev.goal:undefined,carries_on:order?orderText(order):'nothing for autopilot to carry on: give the command (move_to, hunt, follow, rest) and it holds to that',notes:notes.length?notes.join(' '):undefined}}
// The agent gives up or keeps it.
export function endIntent(a,why){const I=a.intent;if(!I||I.done)return {ok:false,error:'You have no aim to set down. intent {goal, why} states one.'};
  I.done={at:Math.round(S.gameMin),why:clean(why,120)||'set down'};return {ok:true,done:I.goal,note:'What are you trying to do now? intent {goal, why} states the next one.'}}
// A command the agent gives while the aim has none becomes its order (sim/player.js, after a move_to, hunt or follow that went through).
export function attachOrder(a,order){const I=a.intent;if(!I||I.done||!order)return;if(!I.order){I.order=order;I.snap=snapOf(a)}}

export function orderText(o){if(!o)return null;
  return o.kind==='move'?'walking to '+o.label:o.kind==='hunt'?'hunting'+(o.ground?' in '+o.ground:'')+(o.n?' ('+o.n+' kills)':''):o.kind==='follow'?'following '+o.name:o.kind==='wait'?'waiting where you are':o.kind}

// Progress and the end of an aim, each step of an agent hero (sim/player.js playerUpd). Writes only a.intent.
export function intentWatch(a){const I=a.intent;if(!I||I.done)return;const now=S.gameMin,s=I.snap||(I.snap=snapOf(a));
  if(I.untilAt!=null&&now>=I.untilAt){I.done={at:Math.round(now),why:'the time you gave is up'};return}
  const o=I.order;
  if(o&&o.kind==='move'&&o.to&&dist(a,o.to)<=INTENT.NEAR){I.done={at:Math.round(now),why:'you reached '+o.label};return}
  if(o&&o.kind==='hunt'&&o.n&&(a.kills||0)-(o.k0||0)>=o.n){I.done={at:Math.round(now),why:o.n+' kills made'};return}
  if(o&&o.kind==='follow'){const b=S.agents.find(x=>x.id===o.id);if(!b||b.state==='dead'){I.done={at:Math.round(now),why:o.name+' is gone'};return}}
  const busy=a.state==='camp'||a.state==='fight'||a.state==='duel'||a.state==='dungeon'||a.state==='raid'||(S.table&&S.table.ids&&S.table.ids.includes(a.id));
  const moved=(a.kills||0)!==s.kills||(a.xp||0)!==s.xp||a.lvl!==s.lvl||dist(a,s)>=INTENT.STEP||(a.adv||null)!==s.adv||advIdx(a)!==s.idx;
  if(busy||moved||(o&&o.kind==='wait')){I.prog=Math.round(now);if(moved)I.snap=snapOf(a)}}

// 'none' | 'set' | 'stale' | 'done'
export function aimState(a){const I=a&&a.intent;if(!I)return 'none';if(I.done)return 'done';if(S.gameMin-(I.prog??I.set)>=INTENT.STALE)return 'stale';return 'set'}
export const aimHeld=a=>{const s=aimState(a);return s==='set'||s==='stale'}; // autopilot still carries a stale aim on
// "to the Mirefen ford, for the wight job (set 3 h ago; until dusk)"
export function aimLine(a){const I=a&&a.intent;if(!I)return null;const now=S.gameMin;
  const until=I.untilAt!=null?(I.done?'':'; '+mins(I.untilAt-now)+' left'):I.until?'; until '+I.until:'';
  return I.goal+(I.why?', '+I.why:'')+' (set '+mins(now-I.set)+' ago'+until+(I.done?'; done: '+I.done.why:'')+')'}
// The aim the hero's company leader shouted in its hearing, while it is still the leader and the shout is recent.
export function leaderAimLine(a,leader){const h=a&&a.heardAim;if(!h||!leader||leader===a||leader.id!==h.id)return null;
  if(S.gameMin-h.at>INTENT.LEAD_AGE)return null;return h.name+' (who leads you) shouted their aim '+mins(S.gameMin-h.at)+' ago: "'+h.text+'"'}

// The pace header's aim (sim/pace.js): {line, state, ask, why?, wait_limit?, leader?}. ask: the next turn asks first
// "What are you trying to do now?" (the aim is done, stale, or was never stated).
export function aimBrief(a,leader){const st=aimState(a),I=a.intent,o={state:st,line:aimLine(a),ask:st!=='set'};
  if(st==='none')o.why='you have not said what you are trying to do';
  else if(st==='done')o.why='your last aim is done ('+I.done.why+')';
  else if(st==='stale')o.why='no progress toward it for '+mins(S.gameMin-(I.prog??I.set));
  if(st==='none'||st==='done')o.wait_limit='with no aim, wait is held to '+mins(INTENT.WAIT_NOAIM);
  const l=leaderAimLine(a,leader);if(l)o.leader=l;return o}

// The intent tool's read (no goal given): the aim, its state and what autopilot carries on.
export function intentView(a,leader){const b=aimBrief(a,leader),I=a.intent;
  return {ok:true,aim:b.line,state:b.state,...(I&&!I.done&&I.order?{carries_on:orderText(I.order)}:{}),...(b.leader?{leader_aim:b.leader}:{}),
    note:b.ask?'What are you trying to do now? intent {goal, why, until?} says it ('+b.why+').':'intent {goal, why, until?} changes it; intent {done: "yes"} sets it down.'}}
