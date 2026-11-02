// Reflection moments (issue #179): at natural pauses an agent-played hero's runner gives it a short turn to write
// memories ("Before you rest: what is worth remembering?"). Owned by brain-builder. DOM-free, RNG-free; only agent-played
// heroes are touched (every hook returns at once for anyone else), so the seeded headless sim is unchanged.
//
//   a.reflect = {seq, cur:{id, why:[..], gm}|null, d, n, dusk, last, ev, log:[{id, why, gm, day, wrote}]}
//     cur   a moment raised by the world (moment(a, why)): making camp, the end of a Table scene, a companion's death,
//           an oath kept, a big trade, a conversation (talked(): REFLECT.TALK lines to others); several close together merge.
//     dusk  the last game day whose evening reflection is done (one a day, offered from REFLECT.DUSK, only when
//           something happened since the last reflection).
//     d, n  the game day and the reflections done on it (REFLECT.PER_DAY at most, whatever their kind).
//     last  game minute of the last reflection (REFLECT.GAP between two); ev the hero's event counter then.
//
// The runner reads the due moment from its state header (sim/pace.js paceBrief: brief.reflect = {id, kind, why}),
// plays it (local/OpenAI: one forced structured answer of 0-3 notes it submits with remember; Claude: the same
// prompt with tool use) and closes it with POST /play/pace {reflected: id, wrote: n}. A note written while a moment
// is due closes it too (so a runner or relay from before #179 still counts), and the notes written then carry rf.
// A moment not answered within REFLECT.TTL game minutes lapses. A due moment wakes a pacing runner softly (sim/pace.js
// paceCheck with reflect: after the minimum gap, like news); something that cannot wait always comes first.
import {S} from './state.js';

export const REFLECT={
  PER_DAY:4,    // reflections a member may do in one game day (the evening one plus major events)
  GAP:90,       // game minutes between two reflections (moments in between wait, merged)
  TTL:360,      // game minutes a raised moment stays due
  DUSK:19*60,   // minute of the day from which the evening reflection is offered
  EV_MIN:3,     // events since the last reflection for "something happened" (or an order the agent gave)
  OPEN:30,      // game minutes after a reflection during which further notes still count toward it
  WHY:4,        // reasons kept on a merged moment
  LOG:12,       // past reflections kept for the Agent tab
  TRADE:150,    // gold in one buy or sell that makes a big trade
  NOTES:3,      // notes a reflection asks for at most
  TALK:4,       // lines an agent hero says to others (say, party_say, talk_to) within TALK_MIN that make a conversation
  TALK_MIN:180, // game minutes a conversation's lines must fall within
};
export const KINDS={camp:'making camp',scene:'the end of a scene at the table',death:'a companion\'s death',oath:'an oath kept',trade:'a big trade',talk:'a conversation',dusk:'the end of the day',lesson:'a hard lesson'}; // lesson: a near death or a fall witnessed (sim/lore.js, #188)

const DAY=1440;
const dayNo=gm=>Math.floor(gm/DAY)+1;
const clean=(s,n)=>String(s==null?'':s).replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,n);
const live=a=>!!(a&&a.player&&a.kind==='hero'&&a.state!=='dead');
function stateOf(a){const R=a.reflect||(a.reflect={seq:0,cur:null,d:0,n:0,dusk:0,last:-1e9,ev:a.playEvN||0,log:[]});const d=dayNo(S.gameMin);if(R.d!==d){R.d=d;R.n=0}return R}

// The world raises a moment for one agent-played hero. kind: a key of KINDS; detail: a few words of what happened.
export function moment(a,kind,detail){if(!live(a))return;const R=stateOf(a),gm=Math.round(S.gameMin),why=clean((KINDS[kind]||kind)+(detail?': '+detail:''),140);
  if(R.cur&&gm-R.cur.gm<=REFLECT.TTL){if(!R.cur.why.includes(why))R.cur.why.push(why);if(R.cur.why.length>REFLECT.WHY)R.cur.why.shift();R.cur.kind=R.cur.kind||kind;return}
  R.cur={id:'m'+(++R.seq),kind,why:[why],gm}}

// A line the agent hero said or asked (say, party_say, talk_to). TALK lines to others within TALK_MIN make a
// conversation worth a reflection (until #170 brings full NPC conversations, which can call moment(a,'talk',...)).
// names: who heard or answered, as the hero saw them.
export function talked(a,names){if(!live(a))return;const R=stateOf(a),gm=Math.round(S.gameMin),L=(names||[]).map(n=>clean(n,24)).filter(Boolean);if(!L.length)return;
  const T=R.talk&&gm-R.talk.gm<=REFLECT.TALK_MIN?R.talk:(R.talk={n:0,gm,who:[]});T.n++;for(const n of L)if(!T.who.includes(n)&&T.who.length<4)T.who.push(n);
  if(T.n>=REFLECT.TALK){moment(a,'talk','with '+T.who.join(', '));R.talk=null}}

// The moment due now for this hero, or null. Pure read: nothing changes.
export function reflectDue(a){if(!live(a)||!a.reflect&&!duskDue(a,null))return null;const R=a.reflect||{n:0,d:0,last:-1e9,cur:null,dusk:0,ev:0},gm=S.gameMin,d=dayNo(gm);
  const n=R.d===d?R.n:0;if(n>=REFLECT.PER_DAY||gm-R.last<REFLECT.GAP)return null;
  if(R.cur&&gm-R.cur.gm<=REFLECT.TTL)return {id:R.cur.id,kind:R.cur.kind,why:R.cur.why.join('; ')};
  if(duskDue(a,R))return {id:'d'+d,kind:'dusk',why:KINDS.dusk+' (day '+d+')'};
  return null}
function duskDue(a,R){const gm=S.gameMin,d=dayNo(gm);if(gm%DAY<REFLECT.DUSK)return false;if(!R)return (a.playEvN||0)>=REFLECT.EV_MIN; // a new mind that never reflected: its first evening
  if(R.dusk>=d)return false;return (a.playEvN||0)-(R.ev||0)>=REFLECT.EV_MIN||(a.playActAt!=null&&a.playActAt>R.last)}

// The runner (or a note written while due) closes the moment. -> {ok, ...} for the pace answer.
export function reflectDone(a,id,wrote){if(!a||a.kind!=='hero')return {ok:false,error:'No such hero.'};const R=stateOf(a),gm=Math.round(S.gameMin),k=Math.max(0,Math.min(20,Math.round(Number(wrote)||0)));
  const past=R.log.find(x=>x.id===id&&gm-x.gm<=REFLECT.OPEN);if(past){past.wrote=Math.max(past.wrote,k);return {ok:true,reflected:id,wrote:past.wrote,already:true}} // closed already (by its first note)
  const due=reflectDue(a);if(!due||due.id!==id)return {ok:false,error:'No reflection '+id+' is due.'};
  R.n++;R.last=gm;R.ev=a.playEvN||0;if(due.kind==='dusk'||gm%DAY>=REFLECT.DUSK)R.dusk=dayNo(gm);if(R.cur&&R.cur.id===id)R.cur=null;
  R.log.push({id,kind:due.kind,why:due.why,gm,day:dayNo(gm),wrote:k});if(R.log.length>REFLECT.LOG)R.log.shift();
  return {ok:true,reflected:id,wrote:k,today:R.n}}

// sim/notebook.js calls this for every remember: a note written while a moment is due (or just after one) belongs to
// it. -> the reason to stamp on the note (n.rf), or null.
export function noteWritten(a){if(!live(a))return null;const R=a.reflect,gm=S.gameMin;
  const open=R&&R.log.length?R.log[R.log.length-1]:null;if(open&&gm-open.gm<=REFLECT.OPEN){open.wrote++;return open.kind}
  const due=reflectDue(a);if(!due)return null;const r=reflectDone(a,due.id,1);return r.ok?due.kind:null}

// The Agent tab's line: reflections today and the last one.
export function reflectView(a){const R=a&&a.reflect;if(!R)return null;const last=R.log[R.log.length-1]||null,d=dayNo(S.gameMin);
  return {today:R.d===d?R.n:0,perDay:REFLECT.PER_DAY,last:last?{day:last.day,gm:last.gm,why:last.why,wrote:last.wrote}:null,due:reflectDue(a)}}
