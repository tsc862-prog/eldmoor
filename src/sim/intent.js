// The hero's stated aim (issue #535): an agent-played hero says, in its own words, what it is trying to do now.
//   a.intent = {goal, why, until, untilAt, set, prog, snap, order, done, n}
//     goal/why/until  the agent's words (until: a condition, or game hours read into untilAt)
//     set             game minute it was stated; prog: last game minute with progress toward it (a kill, XP, a level,
//                     INTENT.STEP tiles walked, the adventure's next scene); stale after INTENT.STALE without progress
//     order           what autopilot carries on for it, where the aim maps to one (sim/player.js): {kind:'move', label, to},
//                     {kind:'hunt', n, k0, prey?, ground?}, {kind:'follow', id, name}, {kind:'wait'}; null when it maps to none
//                     #727: a town errand (errandOf: ask, buy, train, board, rest words) is {kind:'wait', errand, town} in that
//                     town until untilAt (INTENT.ERRAND by default, never past INTENT.WAIT_MAX); a move aim with errand words becomes one on
//                     arriving in town. It is a wait like any other (#790): it earns nothing and goes stale; only running the errand is progress
//   errand/acted/inTown  #727: the errand word, whether a talk/list_jobs/buy/sell/earshot ran it, whether it was held in town
//   a.intentPast       #727: the last INTENT.PAST finished goals, so a forced answer copying one word for word is dropped
//     waitAt          #727: the game minute a walked errand arrived and began to wait; the wait cap counts from it
//     untilLevel/untilAll  a level condition read from the until words (#790): done when this hero (all: every present party member) reaches it
//     done            {at, why} once kept, the time given is up, or the agent let it go; the aim is then read as "done"
//   a.intentSeq        aims stated so far (the behavior digest counts them per hero per game day)
//   a.heardAim         the last aim a company leader shouted in this hero's hearing: {id, name, text, at}
// Agent-played heroes only, no RNG, never part of a scripted hero's step: the seeded world is unchanged.
// Private to the hero (in-game channels, #123): only a leader's shout leaves it, as a party line heard in range.
import {S} from './state.js';
import {dist} from '../world/map.js';
import {sceneOf} from './scenes.js'; // the hero's own company scene (#518)

export const INTENT={
  STALE:120,      // game minutes without progress before the aim is stale and the next turn asks again
  WAIT_DEF:120,   // a wait-like aim with no until ends after this many game minutes
  WAIT_MAX:240,   // a wait-like aim ends after at most this many game minutes whatever its until says (#790); a camp's rest is exempt
  WAIT_NOAIM:120, // with no aim, the wait tool is held to this many game minutes
  NO_AIM:120,     // behavior: an agent hero with no aim this long outside camp or town rest -> no-aim anomaly
  GOAL:160,WHY:200,UNTIL:100,
  HOURS:[.25,72], // until in game hours, bounds
  PER_DAY:12,     // aims stated a game day
  STEP:4,         // tiles walked that count as progress
  NEAR:3,         // tiles from a move aim's place that count as there
  LEAD_AGE:720,   // game minutes a leader's shouted aim stays in a follower's header
  ERRAND:240,     // game minutes a town errand (ask, buy, rest, ...) holds the hero in town when the aim gives no hours (#727)
  PAST:6,         // finished aims remembered, so a forced answer that copies one word for word is dropped (#727)
};
// An errand's end: INTENT.ERRAND from now, never past the wait cap (#727, #790). waitFrom: when an aim's waiting began, the arrival for
// a walked errand (I.waitAt), else when it was set: the walk there was not a wait, the time in town is.
const errandEnd=()=>Math.round(S.gameMin+Math.min(INTENT.ERRAND,INTENT.WAIT_MAX));
export const waitFrom=I=>I.waitAt??I.set;
const clean=(s,n)=>String(s==null?'':s).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,n);
const mins=m=>{m=Math.max(0,Math.round(m));return m<60?m+' min':Math.round(m/60*10)/10+' h'};
const snapOf=a=>({x:a.x,y:a.y,kills:a.kills||0,xp:a.xp||0,lvl:a.lvl,adv:a.adv||null,idx:advIdx(a)});
const advIdx=a=>{if(!a.adv||!S.adventures)return null;const v=S.adventures.find(x=>x.id===a.adv);return v?v.idx:null};
const WAITISH=/^(?:to\s+)?(?:wait|rest|camp|stay|hold|sit|sleep|keep watch|stand watch|linger|bide)\b/i;
export const waitish=g=>WAITISH.test(String(g||'').trim());
// A town errand (#727): an aim whose words ask for something done among people (ask, talk, information, rumours, directions,
// learn, find out, buy, sell, a trainer, the board, rest, recover). In town it is a wait-kind order: autopilot keeps the hero
// there until the aim's until (INTENT.ERRAND by default) instead of walking it back out to hunt.
const ERRANDS=[
  ['ask',/\b(ask(?:ing)?|talk(?:ing)?|speak(?:ing)?|inquir\w*|enquir\w*|information|info|rumou?rs?|directions?|find out|learn(?:ing)?|news)\b/i,'talk to someone here (talk {target}), or read the board (list_jobs)'],
  ['buy',/\b(buy(?:ing)?|sell(?:ing)?|trade|shop(?:ping)?|supplies|potions?)\b/i,'buy or sell here (buy, sell)'],
  ['train',/\b(trainer|train(?:ing)?|profession)\b/i,'find the trainer (learn_profession)'],
  ['board',/\b(board|jobs?|work|bount(?:y|ies))\b/i,'read the board (list_jobs)'],
  ['rest',/\b(rest(?:ing)?|recover(?:ing)?|heal(?:ing)?|sleep)\b/i,'rest here (rest)'],
];
export function errandOf(g){const t=String(g||'');for(const [k,re,next] of ERRANDS)if(re.test(t))return {k,next};return null}
export const errandWord=g=>{const e=errandOf(g);return e?e.k:null};
const normGoal=g=>String(g||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
// A forced answer's aim that is a finished aim word for word (#727): a weak model copies a stale aim from its context.
export function staleCopy(a,g){const n=normGoal(g);if(!n)return false;const I=a.intent;
  if(I&&(I.done||aimState(a)==='stale')&&normGoal(I.goal)===n)return true;
  return (a.intentPast||[]).includes(n)&&!(I&&!I.done&&aimState(a)==='set'&&normGoal(I.goal)===n)}
// A tool that runs the errand (#727): progress toward the aim; talk, list_jobs, buy, sell and earshot (learn_profession for a
// trainer) count as acting on it. The behavior watch flags an errand aim (not a rest) that was in town and ended with none of
// them: errand-unacted.
const ERRAND_PROG=new Set(['talk','list_jobs','buy','sell','learn_profession','rest','earshot']),ERRAND_ACT=new Set(['talk','list_jobs','buy','sell','earshot','learn_profession']);
export function errandTool(a,tool){const I=a&&a.intent;if(!I||I.done||!I.errand||!ERRAND_PROG.has(tool))return; // an errand's own: a plain wait reading the board is still a wait (#790)
  I.prog=Math.round(S.gameMin);if(ERRAND_ACT.has(tool))I.acted=true}

// until: a number or "3", "3h", "3 hours", "90 min", "1.5 hours" -> game minutes; anything else is a condition in words.
export function untilOf(u){if(u==null||u==='')return {text:null,at:null};
  if(typeof u==='number'&&Number.isFinite(u))return hoursAt(u,u+' h');
  const t=clean(u,INTENT.UNTIL);if(!t)return {text:null,at:null};
  const m=/^(?:for\s+|in\s+)?(\d+(?:\.\d+)?)\s*(h|hrs?|hours?|m|mins?|minutes?)?(?:\s+of\s+game\s+time)?$/i.exec(t);
  if(m){const v=Number(m[1]),unit=(m[2]||'h').toLowerCase();return hoursAt(unit.startsWith('m')?v/60:v,t)}
  return {text:t,at:null}}
function hoursAt(h,text){const v=Math.min(INTENT.HOURS[1],Math.max(INTENT.HOURS[0],Number(h)||1));return {text:String(text),at:Math.round(S.gameMin+v*60),hours:v}}

// A level condition in words (#790): "level 4", "level four", "all five are level four", "until we are level 5". -> {level, all} or null
const NUMW={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,twenty:20};
export function levelCond(text){const t=String(text||'').toLowerCase();const m=/\b(?:level|lvl|lv\.?)\s*(\d{1,2}|[a-z]+)\b/.exec(t)||/\b(?:reach|reaches|reached|hit|hits)\s+(?:level\s+)?(\d{1,2})\b/.exec(t);if(!m)return null;
  const n=/^\d+$/.test(m[1])?Number(m[1]):NUMW[m[1]];if(!n||n<2||n>40)return null;
  return {level:n,all:/\b(all|everyone|everybody|each|every|we|us|both|together|knot|company|party|fellowship)\b/.test(t)}}
// The party members present with the hero (itself included): within shouting range and alive.
const presentWith=a=>{const L=a.party&&a.party.mem?a.party.mem.filter(b=>b===a||(b.state!=='dead'&&b.state!=='ghost'&&!b.hidden&&dist(a,b)<=12)):[a];return L.length?L:[a]};

// State it (the tool, through sim/player.js, which maps the order). -> {ok, ...} or {ok:false, error}
export function setIntent(a,{goal,why,until}={},order=null,opt={}){
  const g=clean(goal,INTENT.GOAL).replace(/^["“]|["”]$/g,'');if(!g)return {ok:false,error:'Say your aim: intent {goal: what you are trying to do now, why: the reason, until: hours or a condition (optional)}.'};
  if(opt.forced&&staleCopy(a,g))return {ok:true,dropped:'stale aim dropped',note:'That is an aim you already finished, word for word: it is not set again. What are you trying to do now? Say it in new words, for where you stand.'}; // #727
  const d=Math.floor(S.gameMin/1440),D=a.intentDay&&a.intentDay.d===d?a.intentDay:(a.intentDay={d,n:0});
  if(D.n>=INTENT.PER_DAY)return {ok:false,error:'You have changed your aim '+D.n+' times today. Keep to the one you have: '+(a.intent&&!a.intent.done?a.intent.goal:'none')+'.'};
  const w=clean(why,INTENT.WHY),u=untilOf(until),notes=[];
  if(!w)notes.push('Next time say why, in a few words: it keeps you to it.');
  const lc=levelCond(u.text)||(waitish(g)?levelCond(g):null),errand=!!(order&&order.kind==='wait'&&order.errand);
  if(!lc&&u.at==null&&!u.text&&waitish(g)){Object.assign(u,hoursAt(INTENT.WAIT_DEF/60,null));notes.push('A wait needs a limit: you gave none, so this one ends in '+mins(INTENT.WAIT_DEF)+'.')}
  if(!lc&&u.at==null&&errand)u.at=errandEnd(); // a town errand holds the hero there this long at most (#727)
  if(lc&&opt.level){notes.push(opt.level)}
  else if(!lc&&order&&order.kind==='wait'||!order&&waitish(g)){const cap=Math.round(S.gameMin+INTENT.WAIT_MAX);if(u.at!=null&&u.at>cap)Object.assign(u,{at:cap,hours:INTENT.WAIT_MAX/60});if(u.at==null||u.at===cap){notes.push(errand?'An errand holds you here '+mins(INTENT.WAIT_MAX)+' at most, and the time earns nothing: run it, then state the next aim.':'A wait is held to '+mins(INTENT.WAIT_MAX)+'; waiting earns nothing, so state the next aim when it ends.')}}
  const prev=a.intent&&!a.intent.done?a.intent:null;
  if(a.intent){const P=a.intentPast||(a.intentPast=[]),n=normGoal(a.intent.goal);if(n&&!P.includes(n)){P.push(n);if(P.length>INTENT.PAST)P.shift()}} // #727
  D.n++;a.intentSeq=(a.intentSeq||0)+1;
  a.intent={goal:g,why:w,until:u.text,untilAt:u.at,set:Math.round(S.gameMin),prog:Math.round(S.gameMin),snap:snapOf(a),order:order||null,done:null,n:a.intentSeq,...(errandWord(g)?{errand:errandWord(g)}:{}),...(lc?{untilLevel:lc.level,untilAll:lc.all}:{})};
  return {ok:true,aim:aimLine(a),was:prev?prev.goal:undefined,carries_on:order?orderText(order):'nothing for autopilot to carry on: give the command (move_to, hunt, follow, rest) and it holds to that',notes:notes.length?notes.join(' '):undefined}}
// The agent gives up or keeps it.
export function endIntent(a,why){const I=a.intent;if(!I||I.done)return {ok:false,error:'You have no aim to set down. intent {goal, why} states one.'};
  I.done={at:Math.round(S.gameMin),why:clean(why,120)||'set down'};return {ok:true,done:I.goal,note:'What are you trying to do now? intent {goal, why} states the next one.'}}
// A command the agent gives while the aim has none becomes its order (sim/player.js, after a move_to, hunt or follow that went through).
export function attachOrder(a,order){const I=a.intent;if(!I||I.done||!order)return;if(!I.order){I.order=order;I.snap=snapOf(a)}}

export function orderText(o){if(!o)return null;
  return o.kind==='move'?'walking to '+o.label:o.kind==='hunt'?'hunting'+(o.ground?' in '+o.ground:'')+(o.n?' ('+o.n+' kills)':''):o.kind==='follow'?'following '+o.name:o.kind==='wait'?(o.town?'waiting in '+o.town:'waiting where you are'):o.kind}

// Progress and the end of an aim, each step of an agent hero (sim/player.js playerUpd). Writes only a.intent.
export function intentWatch(a){const I=a.intent;if(!I||I.done)return;const now=S.gameMin,s=I.snap||(I.snap=snapOf(a));
  if(I.untilAt!=null&&now>=I.untilAt){I.done={at:Math.round(now),why:'the time you gave is up'};return}
  const o=I.order;if(I.errand&&a.state==='town')I.inTown=true; // the errand had its chance (the errand-unacted watch, #727)
  if(I.untilLevel){const L=I.untilAll?presentWith(a):[a];if(L.every(b=>b.lvl>=I.untilLevel)){I.done={at:Math.round(now),why:(I.untilAll&&L.length>1?'all of you reached':'you reached')+' level '+I.untilLevel};return}}
  if(((o&&o.kind==='wait')||(!o&&waitish(I.goal)))&&a.state!=='camp'&&now-waitFrom(I)>=INTENT.WAIT_MAX){I.done={at:Math.round(now),why:'the wait you set has run its course'};return}
  if(o&&o.kind==='move'&&o.to&&dist(a,o.to)<=INTENT.NEAR){
    if(I.errand&&o.last==='town'){I.order={kind:'wait',errand:I.errand,town:o.label};I.prog=Math.round(now);I.waitAt=Math.round(now);I.untilAt=Math.min(I.untilAt??errandEnd(),errandEnd());return} // arrived for a town errand: it holds the hero there now, inside the wait cap from here (#727, #790)
    I.done={at:Math.round(now),why:'you reached '+o.label};return}
  if(o&&o.kind==='hunt'&&o.n&&(a.kills||0)-(o.k0||0)>=o.n){I.done={at:Math.round(now),why:o.n+' kills made'};return}
  if(o&&o.kind==='follow'){const b=S.agents.find(x=>x.id===o.id);if(!b||b.state==='dead'){I.done={at:Math.round(now),why:o.name+' is gone'};return}}
  const busy=a.state==='camp'||a.state==='fight'||a.state==='duel'||a.state==='dungeon'||a.state==='raid'||!!sceneOf(a);
  const moved=(a.kills||0)!==s.kills||(a.xp||0)!==s.xp||a.lvl!==s.lvl||dist(a,s)>=INTENT.STEP||(a.adv||null)!==s.adv||advIdx(a)!==s.idx;
  if(busy||moved){I.prog=Math.round(now);if(moved)I.snap=snapOf(a)}}

// 'none' | 'set' | 'stale' | 'done'
export function aimState(a){const I=a&&a.intent;if(!I)return 'none';if(I.done)return 'done';if(S.gameMin-(I.prog??I.set)>=INTENT.STALE)return 'stale';return 'set'}
export const aimHeld=a=>{const s=aimState(a);return s==='set'||s==='stale'}; // autopilot still carries a stale aim on
// "to the Mirefen ford, for the wight job (set 3 h ago; until dusk)"
export function aimLine(a){const I=a&&a.intent;if(!I)return null;const now=S.gameMin;
  const until=I.untilLevel?'; until level '+I.untilLevel+' (you are '+a.lvl+')':I.untilAt!=null?(I.done?'':'; '+mins(I.untilAt-now)+' left'):I.until?'; until '+I.until:'';
  return I.goal+(I.why?', '+I.why:'')+' (set '+mins(now-I.set)+' ago'+until+(I.done?'; done: '+I.done.why:'')+')'}
// The aim the hero's company leader shouted in its hearing, while it is still the leader and the shout is recent.
export function leaderAimLine(a,leader){const h=a&&a.heardAim;if(!h||!leader||leader===a||leader.id!==h.id)return null;
  if(S.gameMin-h.at>INTENT.LEAD_AGE)return null;return h.name+' (who leads you) shouted their aim '+mins(S.gameMin-h.at)+' ago: "'+h.text+'"'}

// The pace header's aim (sim/pace.js): {line, state, ask, why?, wait_limit?, leader?}. ask: the next turn asks first
// "What are you trying to do now?" (the aim is done, stale, or was never stated).
export function aimBrief(a,leader){const st=aimState(a),I=a.intent,sc=!!sceneOf(a),o={state:st,line:aimLine(a),ask:st!=='set'&&!sc}; // its own scene comes first: no ask while it sits in one
  if(st==='none')o.why='you have not said what you are trying to do';
  else if(st==='done')o.why='your last aim is done ('+I.done.why+')';
  else if(st==='stale')o.why=(I.order&&I.order.kind==='wait'||!I.order&&waitish(I.goal)?'waiting has earned nothing for ':'no progress toward it for ')+mins(S.gameMin-(I.prog??I.set));
  if(st==='none'||st==='done')o.wait_limit='with no aim, wait is held to '+mins(INTENT.WAIT_NOAIM);
  if((st==='set'||st==='stale')&&I.errand&&a.state==='town'&&!I.acted){const e=errandOf(I.goal);if(e)o.errand='Your aim says '+e.k+': '+e.next+'.'} // in town on an errand (#727)
  const l=leaderAimLine(a,leader);if(l)o.leader=l;return o}

// The intent tool's read (no goal given): the aim, its state and what autopilot carries on.
export function intentView(a,leader){const b=aimBrief(a,leader),I=a.intent;
  return {ok:true,aim:b.line,state:b.state,...(I&&!I.done&&I.order?{carries_on:orderText(I.order)}:{}),...(b.leader?{leader_aim:b.leader}:{}),
    note:b.ask?'What are you trying to do now? intent {goal, why, until?} says it ('+b.why+').':'intent {goal, why, until?} changes it; intent {done: "yes"} sets it down.'}}
