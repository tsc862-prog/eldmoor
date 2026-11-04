// NPC conversations (issue #170): when a Fellowship member addresses a world character (the talk tool,
// a line said aloud naming them or right next to them, or a staged meeting that ends with the person
// still there), a short conversation opens. Each line the member says is a must-answer call to the DM:
// the DM agent answers as the person (npc_say) and may pick one follow-up per exchange (npc_offer):
// trade, a rumour or hook, a job, combat (a staged ambush or elite, with the usual fairness limits),
// a blessing (priests and hermits), or leaving. The DM agent answers through a fast voice in its runner
// (scripts/dm-agent.mjs talkVoice: one structured model call per exchange) or in a full turn; if it is
// absent or silent past a short real-time budget, the scripted DM answers from the person's role. The
// world never waits: a member who asked is only waiting for a reply, like anyone in the game.
//
// Fellowship first: only members open conversations (background heroes keep the old canned greeting,
// sim/player.js). In-game only (#123): the DM sees the member's spoken lines, the person's record and the
// conversation so far, never a member's journal, notes or memories; members hear the person through chat.
//
// Each person remembers the Fellowship on their own record (plain JSON on the NPC, saved with the world):
//   p.mood 'friendly'|'neutral'|'hostile' (from p.warmth), p.warmth -10..10, p.hostile true once they turned
//   on the party, p.fmem {talks, last, notes:[{d,t,text}]} (what was promised or owed, written by the DM).
// A trade or a kept word warms them, a refused deal or a fight sours them. The UI colours people by p.mood.
//
// Nothing runs unless a member speaks to someone: npm run sim (no tools) never opens a conversation, and the
// scripted lines roll on a private RNG. Owned by brain-builder. DOM-free.
//
// ---- state (plain JSON on S, saved with the world) ----
//   S.talks {seq, call, cur:[conv], past:[short], day:{d, lines, offers, opened}, stats}
//   conv {id, npc, name, heroes:[ids], lines:[{who:'member'|'npc', id, name, text, t}], ex, wait:{call, hero, line, gm, real, by}|null,
//         offers:[{kind, ex, by, mark}], offerEx, state 'open'|'done', born, last, why}
import {S,clockStr} from './state.js';
import {ZONES,ZPTS,CITY,LANDMARKS,CRYPT,zoneAt,zoneFor,dist} from '../world/map.js';
import {FAC} from '../data/factions.js';
import {USES,SLOTS} from '../data/items.js';
import {ELITES} from '../data/mobs.js';
import {ADVENTURES} from '../data/adventures.js';
import {homeOf} from '../data/races.js';
import {ROLE_TALK,DEFAULT_TALK,ROLE_JOB,ROLE_STOCK,DEFAULT_STOCK,TALK_LINES} from '../data/talk-lines.js';
import {dmlog} from './dmlog.js';
import {noteKnownAt} from './sightings.js';
import {pull,spotErr,attitudeOf,LK} from './levers.js';
import {maxHp,huntZone} from './heroes.js';
import {check} from './abilities.js';
import {notify} from './notify.js';
import {remember} from './memory.js';
import {CAP as CHAT_CAP,BUBBLE,HEAR} from './chat.js';
import {ensureNpcs} from './npcs.js';
import {stageScene} from './staged.js';
import {heard,since,dmAlive,goneEpoch,callDeadline,lateWhy} from './dmreflex.js'; // the DM's reflexes (#561)
import {invOf,used,capOf,addUse,addGear,sellLoot,sellEntry} from './inv.js';
import {npcWarning,captainWarning,jobRumour,learnPlace,learnJob} from './lore.js'; // a townsperson warns a green blade off the next region up (#188)
import {equip,makeItem,SHOP_COST,slotLevel,weakestSlot,refreshEpics,itemStats} from './gear.js';
import {inSlots,slotHeroes,slotKeyOf,slotted} from './company.js'; // the slotted company (#588)
import {hireKind,priceFor,HIRE} from './hire.js'; // a hire offer (#634); used inside functions only (hire.js imports this file)
import {rumoursFor,tell as tellRumour,carries} from './rumours.js'; // word the DM seeded for the town's tellers (#637)
import {spokenAbout} from './epithet.js'; // a hero refusing a name given (#638)

// ---- knobs ----
export const CONV={
  EXCHANGES:4,        // member lines a conversation runs to (the last answer closes it)
  DM_EXCHANGES:10,    // ... once the DM agent has voiced the person in it: a longer talk, with follow-ups (#571)
  HMEM_KEEP:12,       // heroes a person remembers one by one (#571: p.hmem), the least recent forgotten first
  OPEN_MAX:3,         // conversations open at once
  PER_DAY:16,         // conversations opened per game day
  DM_LINES_PER_DAY:40,// the DM agent's conversation lines per game day (the Fellowship's own share, apart from npc_say's 16)
  DM_OFFERS_PER_DAY:12,// the DM agent's follow-ups per game day
  VOICE_MS:8000,      // real ms the game waits for the DM's fast voice (its runner polled npc_call recently)
  VOICE_MIN:4000, VOICE_MAX:30000, // the range a voice may ask for with npc_call {budget_s} (a local model needs longer)
  TURN_MS:40000,      // real ms it waits when only a DM turn is running (a DM tool call recently, no voice)
  GRACE_MS:12000,     // real ms the game waits for a live but busy DM (queued behind other calls) before the scripted answer (#540)
  BUSY_MS:90000,      // real ms: a DM call this recent counts as a live runner even without the host's word
  POLL_MS:6000,       // real ms: a DM poll or call this recent counts as a DM listening
  WAIT_GM:720,        // game minutes a call may wait at most, whatever the clock (a paused tab, a stuck runner)
  TALK_R:6,           // tiles: a line naming a person reaches them from this far
  NEXT_R:2,           // tiles: a line said right next to a person, with no companion near, is said to them
  ALONE_R:4,          // ... "no companion near": no other living hero within this many tiles
  LEAVE_R:10,         // tiles: everyone in a conversation this far from the person ends it
  IDLE_GM:60,         // game minutes without a line before a conversation lapses
  SNUB_GM:240,        // game minutes a person who walked off will not talk to that member again
  TRADE_GM:120,       // game minutes an opened trade stays open
  HURT:.35,           // a member below this share of HP near the person: no combat follow-up
  HURT_R:14,          // ... within this many tiles of the person
  LINE_MAX:200,       // a member's line (say keeps its 200, #151)
  DM_LINE_MAX:2000,   // the person's line from the DM: a technical ceiling only, the DM writes as much as the moment needs (owner, #170)
  LEAD_MAX:600, NOTE_MAX:160, NOTES_KEEP:8, PAST_KEEP:12,
};
export const OFFER_KINDS=['trade','rumour','job','combat','blessing','hire','leave'];
const MOODS=['hostile','neutral','friendly'];
const DAY=1440;

// Private LCG (like sim/npcs.js): the scripted lines never touch the gameplay RNG.
const SEED0=0x5bd1e995;let seed=SEED0;export const resetTalkSeed=()=>{seed=SEED0}; // init() puts the private stream back (#674)
const r=()=>{seed=(Math.imul(seed,1103515245)+12345)&0x7fffffff;return seed/0x80000000};
const pick=L=>L[Math.floor(r()*L.length)];

// ---- helpers ----
const clean=(s,n)=>String(s==null?'':s).replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,n);
const hero=id=>S.agents.find(x=>x.id===id)||null;
const living=a=>a&&a.state!=='dead'&&!a.hidden;
const npcById=id=>(S.npcs||[]).find(x=>x.id===id)||(S.wanderers||[]).find(x=>x.id===id)||null;
const full=p=>(p.title?p.title+' ':'')+p.name;
const fill=(s,o)=>String(s).replace(/\{(\w+)\}/g,(_,k)=>o[k]!=null?String(o[k]):k);
const gameDay=()=>Math.floor(S.gameMin/DAY);
const talkOf=p=>ROLE_TALK[p.role]||DEFAULT_TALK;
export function talkState(){return S.talks||(S.talks={seq:0,call:0,cur:[],past:[],day:{d:-1,lines:0,offers:0,opened:0},
  stats:{opened:0,lines:0,dm:0,scripted:0,late:0,offers:{},refused:0}})}
function today(){const T=talkState();if(T.day.d!==gameDay())T.day={d:gameDay(),lines:0,offers:0,opened:0};return T.day}
const log=(summary,detail)=>dmlog('talk',null,summary,{...detail,by:detail.by==='dm-agent'?'dm-agent':'scripted',...(detail.by&&detail.by!=='dm-agent'&&detail.by!=='scripted'?{from:detail.by}:{})},{heroes:[]}); // by: who spoke (the DM agent, or the scripted DM and the game around it) // heroes [] on purpose (see staged.js): readDm would carry DM bookkeeping into the campaign log

// ---- escalation to a Table scene (#407, rules in sim/talkscene.js) ----
// The hook gets (c, p, a, {line} | {offer, hook}) and returns {note} when the talk became a scene, else null.
let escHook=null;
export function setTalkEscalation(f){escHook=f}

// ---- the person's record of the Fellowship ----
const ATT_WARM={hostile:-5,wary:-2,neutral:0,friendly:4};
const moodOf=w=>w>=3?'friendly':w<=-4?'hostile':'neutral';
export function recordOf(p,a){if(p.warmth==null){const att=attitudeOf(p,a?[a]:slotHeroes(slotted()));p.warmth=ATT_WARM[att]??0}
  p.mood=p.hostile?'hostile':moodOf(p.warmth);return p.fmem||(p.fmem={talks:0,last:null,notes:[]})}
export function warm(p,d,why){if(!d)return;recordOf(p);p.warmth=Math.max(-10,Math.min(10,Math.round((p.warmth||0)+d)));if(p.warmth>-4&&p.hostile&&d>0&&p.warmth>=0)delete p.hostile;
  p.mood=p.hostile?'hostile':moodOf(p.warmth);if(why)p.fmem.lastWhy=clean(why,80)}
function noteOn(p,text){const R=recordOf(p),t=clean(text,CONV.NOTE_MAX);if(!t)return;R.notes.push({d:gameDay()+1,t:clockStr(),text:t});if(R.notes.length>CONV.NOTES_KEEP)R.notes.shift()}
// What the DM reads about a person and the Fellowship (npcs and npc_call).
export function recordView(p){if(p.warmth==null&&!p.fmem)return null;const R=recordOf(p);
  return {mood:p.mood,warmth:p.warmth,...(p.hostile?{hostile:true}:{}),talks:R.talks,...(R.last!=null?{last_day:Math.floor(R.last/DAY)+1}:{}),notes:R.notes.map(n=>'D'+n.d+' '+n.text)}}

// ---- the DM listening ----
// The game waits for the DM agent while it listens: its fast voice polled npc_call (VOICE_MS), or it made a DM call
// recently (a turn under way: TURN_MS), or its runner is alive but busy (GRACE_MS). Then the DM's reflexes answer (the
// scripted line; sim/dmreflex.js, #561: the DM is always an agent, there is no seat-closed path). A world no DM runner ever
// spoke to never waits, so a seeded world without one is untouched.
let voiceMs=0;
// When a waiting answer is due (#680): its budget (ms) from the moment the DM first read it (npc_call: seen), never past
// ms + PICKUP_MS from the member's line.
const waitEnd=w=>callDeadline(w.real,w.ms,w.seen);
// tool: the DM tool called; args.budget_s on npc_call: the real seconds the voice says it needs per answer (a local model
// is slower than Haiku), held to VOICE_MIN..VOICE_MAX.
export function dmHeard(tool,args){heard(tool==='npc_call'?'voice':'act');if(tool==='npc_call'){const b=Number(args&&args.budget_s);voiceMs=Number.isFinite(b)&&b>0?Math.max(CONV.VOICE_MIN,Math.min(CONV.VOICE_MAX,b*1000)):0}}
// A live but busy DM (#540): its runner is alive (the host says so, setDmAlive) or it was heard within BUSY_MS, but it is not
// polling right now (queued behind other calls): the game waits GRACE_MS before the scripted DM answers, like a queued member (#515).
export {setDmAlive} from './dmreflex.js';
function dmBudget(){const v=since('voice'),t=since('act'),alive=dmAlive();
  const ms=v<CONV.POLL_MS?voiceMs||CONV.VOICE_MS:t<CONV.POLL_MS?CONV.TURN_MS:alive||t<CONV.BUSY_MS?CONV.GRACE_MS:0;
  if(!ms)return 0; // nobody listening: the reflex answers at once (and today() is never touched)
  return today().lines>=CONV.DM_LINES_PER_DAY?0:ms}

// ---- finding who a member speaks to ----
const people=()=>{ensureNpcs();return [...(S.npcs||[]),...(S.wanderers||[])].filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))};
const named=(p,t)=>{const s=t.toLowerCase(),n=String(p.name||'').toLowerCase();if(n&&new RegExp('\\b'+n.replace(/[^a-z0-9 ]/g,'.')+'\\b').test(s))return true;
  const ti=String(p.title||'').toLowerCase();return !!ti&&s.includes(ti)};
export const convWith=p=>(S.talks?S.talks.cur:[]).find(c=>c.npc===p.id&&c.state==='open')||null;
export const convById=id=>(S.talks?S.talks.cur:[]).find(c=>c.id===Number(id))||null;
// For the say tool: the person a member's line is said to, or null. An open conversation within earshot first, then
// a person named in the line within TALK_R, then one right next to the member with no companion near.
export function addressed(a,text){if(!a||!inSlots(a)||!slotted())return null;
  for(const c of (S.talks?S.talks.cur:[]))if(c.state==='open'){const p=npcById(c.npc);if(p&&dist(a,p)<=HEAR&&(c.heroes.includes(a.id)||dist(a,p)<=CONV.TALK_R))return p}
  const P=people();let best=null,bd=1e9;
  for(const p of P){const d=dist(a,p);if(d<=CONV.TALK_R&&named(p,text)&&d<bd){best=p;bd=d}}
  if(best)return best;
  for(const p of P){const d=dist(a,p);if(d<=CONV.NEXT_R&&d<bd){best=p;bd=d}}
  if(best&&!S.agents.some(b=>b!==a&&living(b)&&b.kind==='hero'&&dist(a,b)<=CONV.ALONE_R))return best;
  return null}
// For the talk tool: a person by id, name, role or title within `range` (townsfolk of the member's town or any wanderer).
export function findPerson(a,t,range){const s=String(t||'').trim().toLowerCase();if(!s)return null;
  const P=people();let best=null,bd=1e9;
  for(const p of P){const ok=String(p.id)===s||String(p.name).toLowerCase()===s||p.role===s||String(p.title||'').toLowerCase()===s||full(p).toLowerCase()===s;
    if(!ok)continue;const d=dist(a,p);if(d<bd){best=p;bd=d}}
  return best&&bd<=range?best:best?{far:best,d:bd}:null}

// ---- a member speaks ----
// talkTo: the member's line to person p (text may be empty: a greeting). Opens or continues the conversation, then
// either waits for the DM agent (the answer arrives as a line heard) or answers at once from the role. Returns a
// plain result for the tool, or {error}.
export function talkTo(a,p,text){const T=talkState(),d=today();
  if(!inSlots(a)||!slotted())return {error:'Only the Fellowship holds conversations.'};
  recordOf(p,a);
  if(p.snub&&p.snub[a.id]>S.gameMin)return {ok:true,who:full(p),answer:'('+fill(pick(TALK_LINES.snub),{name:p.name})+')',ended:true};
  let c=convWith(p);
  if(c&&c.wait)return {ok:true,who:full(p),waiting:true,note:p.name+' has not answered your last words yet. Give them a moment (wait, or chat_read).'};
  if(!c){if(T.cur.filter(x=>x.state==='open').length>=CONV.OPEN_MAX)return {error:'Too many conversations at once: finish one first.'};
    if(d.opened>=CONV.PER_DAY)return {error:'You have talked enough for one day; people have work to do.'};
    c={id:++T.seq,npc:p.id,name:full(p),heroes:[],lines:[],ex:0,wait:null,offers:[],offerEx:-1,state:'open',born:Math.round(S.gameMin),last:Math.round(S.gameMin)};
    T.cur.push(c);d.opened++;T.stats.opened++;const R=recordOf(p);R.talks++;R.last=Math.round(S.gameMin);
    log(['Conversation: ',a.name,' speaks to ',full(p),(p.town?' in '+p.town:' in '+(ZONES[zoneAt(p.x,p.y)]||'the wilds'))+'.'],{conv:c.id,npc:p.id,hero:a.id,open:true})}
  let read=null;if(!c.heroes.includes(a.id)){c.heroes.push(a.id);read=readPerson(c,p,a)}
  const met=a.metNpc||(a.metNpc={});if(!met[p.id]){met[p.id]=gameDay()+1;c.fresh=true} // a first meeting may carry a warning (#540)
  const line=clean(text,CONV.LINE_MAX)||'(greets '+p.name+')';
  c.lines.push({who:'member',id:a.id,name:a.name,text:line,t:clockStr()});c.ex++;c.last=Math.round(S.gameMin);T.stats.lines++;
  p.face=a.x>p.x?1:-1;
  log([a.name+' to '+full(p)+': "',line,'"'],{conv:c.id,npc:p.id,hero:a.id,who:'member',text:line});
  const esc=escHook&&escHook(c,p,a,{line:clean(text,CONV.LINE_MAX)}); // a decision: the company answers at the table (#407)
  if(esc)return {ok:true,who:full(p),said:line,...(read?{read}:{}),table:esc.note};
  const ms=dmBudget();
  if(ms>0){c.wait={call:++T.call,hero:a.id,line,gm:Math.round(S.gameMin),real:Date.now(),ep:goneEpoch(),ms,by:ms===CONV.TURN_MS?'turn':'voice'};
    return {ok:true,who:full(p),said:line,...(read?{read}:{}),waiting:true,note:p.name+' is thinking it over: their answer comes as a line you hear (chat_read, or the next events).'}}
  const out=scripted(c,p,a);return {ok:true,who:full(p),said:line,...(read?{read}:{}),answer:out.text,...(out.mark?{follow_up:out.mark}:{}),...(out.hint?{note:out.hint}:{}),...(c.state==='done'?{ended:true}:{})}}

// Listening (#170): the first time a member speaks in a conversation they read the person, an Empathy check (on Insight)
// against 11, +3 if the person is hostile, -2 if friendly. Everyone hears the words; the roll is whether they catch what
// the person wants under them. The member learns it (result and memory), the DM sees who did (npc_call member.read_them).
function readPerson(c,p,a){const want=p.want||talkOf(p).want,R=check(a,'empathy',11+({hostile:3,friendly:-2}[p.mood]||0),{nat:true});
  (c.read||(c.read={}))[a.id]=R.pass;const n=full(p),d=' (empathy '+R.total+' vs '+R.dc+')';
  log([a.name+(R.pass?' understood '+n+': '+want:' listened to '+n+', but missed what they truly want')+d+'.'],{conv:c.id,npc:p.id,hero:a.id,skill:'empathy',d20:R.d20,total:R.total,dc:R.dc,pass:R.pass});
  if(R.pass){remember(a,'talk','I read '+n+': they want '+want+'.');return 'You read '+n+': they want '+want+'.'}
  return 'You listen to '+n+', but cannot tell what they really want.'}

// ---- the person answers ----
// Deliver one line from the person to everyone within earshot (and the members in the conversation), tagged with the
// conversation so a hero's agent wakes at once (sim/player.js hearWake) and the watcher's chat panel can group it.
function speakAs(p,c,text,by,mark){const e={t:clockStr(),d:gameDay()+1,from:{kind:'npc',id:p.id,name:p.name,fac:p.fac},text,trigger:'npc',talk:c.id,dm:true,by};if(mark)e.mark=mark;
  const hs=S.agents.filter(b=>living(b)&&(dist(b,p)<=HEAR||c.heroes.includes(b.id)));if(slotted()&&hs.some(b=>inSlots(b)))e.fh=true;
  for(const b of hs){(b.chat||(b.chat=[])).push(e);if(b.chat.length>CHAT_CAP)b.chat.shift()}
  p.bubble={text,life:BUBBLE};if(e.fh)p.bubble.fh=true;p.chatCd=Math.max(p.chatCd||0,10);
  c.lines.push({who:'npc',id:p.id,name:full(p),text,t:e.t,by,...(mark?{mark}:{})});c.last=Math.round(S.gameMin);
  log([full(p)+(by==='dm-agent'?' (DM agent)':'')+': "',text,'"'+(mark?' '+mark:'')],{conv:c.id,npc:p.id,who:'npc',by,text,...(mark?{mark}:{}),...(by==='scripted'?{fill:true,why:c.wait?'slow':'gone',...(c.wait?{late:lateWhy(c.wait.seen)}:{})}:{})});return e} // a scripted answer is the DM's reflex (#561)
// Word the DM seeded (#637): after the person's answer, a teller passes on what the town is saying, once a game day a hero,
// in their own words. A line the DM's voice already wove it into counts as told (said); else the scripted words follow.
// The line is heard like the answer, never written to the DM log (the telling is counted there by sim/rumours.js).
function passOn(c,p,a,said){if(!S.rumours||!a||!living(a))return;
  for(const r of rumoursFor(p,a)){if(said&&carries(said,r)){tellRumour(r,p,a,'dm voice');continue}
    const text=tellRumour(r,p,a),e={t:clockStr(),d:gameDay()+1,from:{kind:'npc',id:p.id,name:p.name,fac:p.fac},text,trigger:'npc',talk:c.id,dm:true,by:'scripted'};
    for(const b of S.agents.filter(b=>living(b)&&(dist(b,p)<=HEAR||c.heroes.includes(b.id)))){(b.chat||(b.chat=[])).push(e);if(b.chat.length>CHAT_CAP)b.chat.shift()}
    p.bubble={text,life:BUBBLE};c.lines.push({who:'npc',id:p.id,name:full(p),text,t:e.t,by:'scripted'})}}
// A hail (sim/locals.js): the person opens the talk. With the DM agent listening the opening is its to voice (the call waits like
// any other, and the scripted DM fills it if the seat goes quiet); else the scripted line is spoken now. Returns true when spoken.
export function speakAsHail(p,c,text){const a=hero(c.heroes[0]),ms=dmBudget();
  if(ms>0&&a){const T=talkState();c.wait={call:++T.call,hero:a.id,line:'('+full(p)+' calls out to '+a.name+': '+clean(text,CONV.LEAD_MAX)+')',gm:Math.round(S.gameMin),real:Date.now(),ep:goneEpoch(),ms,by:ms===CONV.TURN_MS?'turn':'voice'};return false}
  speakAs(p,c,text,'scripted');return true}
// After an answer: the last exchange closes the conversation.
function afterAnswer(c,p){c.wait=null;if(c.state==='open'&&c.ex>=exMax(c))close(c,'said what they had to say')}
// How long a conversation runs: CONV.EXCHANGES, or CONV.DM_EXCHANGES once the DM agent has voiced the person in it (#571).
const exMax=c=>c&&c.dm?CONV.DM_EXCHANGES:CONV.EXCHANGES;
const exText=c=>c.ex+'/'+exMax(c);
// What a person remembers of one hero (#571): p.hmem[heroId] = {n talks, gm last, said: the hero's last words, what: follow-ups}.
const hmemOf=(p,a)=>p&&a&&p.hmem?p.hmem[a.id]||null:null;
export function lastTime(p,a){const m=hmemOf(p,a);if(!m)return null;return 'Day '+(Math.floor(m.gm/DAY)+1)+(m.n>1?' (talked '+m.n+' times)':'')+(m.said?': they said "'+m.said+'"':'')+(m.what?'; '+m.what:'')}

// The DM agent's answer (npc_say with a conversation): the line, then optional warmth and a note on the person's record.
export function dmAnswer(c,p,text,o={}){const d=today(),T=talkState();
  if(c.state!=='open')return {ok:false,error:'That conversation has ended.'};
  if(d.lines>=CONV.DM_LINES_PER_DAY)return {ok:false,error:'Enough conversation for one game day ('+CONV.DM_LINES_PER_DAY+' lines); the scripted DM answers the rest.'};
  const t=clean(text,CONV.DM_LINE_MAX);if(!t)return {ok:false,error:'Say what?'};
  const was=!!c.wait,to=hero(c.wait&&c.wait.hero)||hero(c.heroes[c.heroes.length-1]);speakAs(p,c,t,'dm-agent');d.lines++;T.stats.dm++;c.dm=1;passOn(c,p,to,t);
  const w=Number(o.warmth);if(Number.isFinite(w)&&w)warm(p,Math.max(-3,Math.min(3,Math.round(w))),'the DM: '+t);
  if(o.remember)noteOn(p,o.remember);
  if(was)afterAnswer(c,p);
  return {ok:true,conv:c.id,answered:was,exchange:exText(c),mood:p.mood,...(c.state==='done'?{ended:c.why}:{})}}

// The scripted DM's answer from the person's role: an opening line and the role's follow-up on the first exchange,
// a reply later, a farewell on the last; a hostile person threatens and walks off.
function scripted(c,p,a){const T=talkState();T.stats.scripted++;if(c.wait&&c.wait.real&&Date.now()>=waitEnd(c.wait))T.stats.late++;
  recordOf(p,a);const mood=p.mood,o={target:a.name,name:p.name,town:p.town||(homeOf(a)&&homeOf(a).name)||'town'};
  let text,mark=null,hint=null;
  if(mood==='hostile'){text=fill(pick(TALK_LINES.threat),o);speakAs(p,c,text,'scripted');const r2=offer(c,p,'leave',{},'scripted');mark=r2.mark;c.wait=null;return {text,mark}}
  const first=c.ex<=1,last=c.ex>=exMax(c),seen=first&&hmemOf(p,a);
  const asked=[...c.lines].reverse().find(l=>l.who==='member'),ans=asked&&!last?townAnswer(p,a,asked.text):null;
  if(ans){if(ans.fit)c.fit=true;text=ans.text;speakAs(p,c,text,'scripted');passOn(c,p,a,null);afterAnswer(c,p);
    return {text,mark,hint:'Townsfolk answer from what is public: '+full(p)+' knows only what the town knows.'}}
  text=fill(pick(last?TALK_LINES.bye:first?TALK_LINES.open[mood]:TALK_LINES.reply[mood]),o); // the greeting only on the first exchange
  if(seen)text='Back again, '+a.name+'?'+(seen.said?' Last time you said "'+(seen.said.length>70?seen.said.slice(0,68)+'..':seen.said)+'".':'')+' '+text; // they remember you (#571)
  speakAs(p,c,text,'scripted');passOn(c,p,a,null);
  if(first&&!last){const k=talkOf(p).offer;if(k&&k!=='none'){const r2=offer(c,p,k,{},'scripted',a);if(r2.ok){mark=r2.mark;hint=r2.hint}
    else if(k==='job'){const r3=offer(c,p,'rumour',{},'scripted',a);if(r3.ok){mark=r3.mark;hint=r3.hint}}}}
  afterAnswer(c,p);return {text,mark,hint}}

// ---- follow-ups ----
// One per exchange. by 'dm-agent' or 'scripted'. Returns {ok, mark, hint, ...} or {ok:false, error}.
export function offer(c,p,kind,args={},by='dm-agent',speaker=null){const T=talkState(),d=today();
  const no=why=>{T.stats.refused++;log(['Follow-up ',kind,' with '+full(p)+' refused: '+why+'.'],{conv:c.id,npc:p.id,kind,by,result:'rejected: '+why});return {ok:false,error:'Refused: '+why}};
  if(!OFFER_KINDS.includes(kind))return no('kind must be one of '+OFFER_KINDS.join(', '));
  if(c.state!=='open')return no('that conversation has ended');
  if(c.offerEx===c.ex)return no('one follow-up per exchange; wait for the member\'s next words');
  if(by==='dm-agent'&&d.offers>=CONV.DM_OFFERS_PER_DAY)return no('enough follow-ups for one game day ('+CONV.DM_OFFERS_PER_DAY+')');
  const mem=c.heroes.map(hero).filter(living),a=speaker||hero(c.wait&&c.wait.hero)||mem[mem.length-1]||null;
  if(!a)return no('nobody of the Fellowship is there any more');
  const home=homeOf(a);let mark,hint,extra={};
  if(kind==='trade'){if(p.mood==='hostile')return no(p.name+' will not trade with the Fellowship (hostile)');
    p.trade={conv:c.id,until:Math.round(S.gameMin+CONV.TRADE_GM),fac:slotted()?slotted().fac:a.fac};
    const st=stockOf(p,a).map(x=>x==='gear'?'gear for your level':x).join(', ');
    mark='[trade opened]';hint=full(p)+' trades with you for '+Math.round(CONV.TRADE_GM/60)+' game hours while you stand near: buy {npc:"'+p.name+'", item} or buy {npc:"'+p.name+'", slot} for gear, sell {npc:"'+p.name+'"} ('+st+'; prices '+priceWord(p)+').';
    if(by==='scripted')speakAs(p,c,fill(pick(TALK_LINES.trade),{stock:st}),by,mark);}
  else if(kind==='rumour'){let lead=clean(args.about||args.text,CONV.LEAD_MAX),at=null,where='';
    if(!lead&&by!=='scripted')return no('a rumour needs about: the lead, written so the member can act on it');
    if(args.place!=null&&args.place!==''){const q=(S.places||[]).find(x=>String(x.id)===String(args.place)||String(x.name).toLowerCase()===String(args.place).toLowerCase());if(!q)return no('no place "'+clean(args.place,40)+'" (see regions)');at=q;where=q.name+' in '+ZONES[q.z]+' ('+Math.round(q.x)+','+Math.round(q.y)+')'}
    else if(args.region!=null&&args.region!==''){const z=regionIdx(args.region);if(z==null)return no('no region "'+clean(args.region,40)+'"');
      const kindM=['ruin','camp','shrine','cairn_door','watchtower'].includes(String(args.marker||''))?String(args.marker):'ruin';
      const pt=(ZPTS[z]||[]).slice((c.id*7)%Math.max(1,(ZPTS[z]||[]).length)).concat(ZPTS[z]||[]).find(q=>!spotErr(q));
      if(pt){const res=pull('mark_place',{kind:kindM,at:{x:pt.x,y:pt.y},hours:72},{by,reason:'a lead from '+full(p)+' in conversation'});
        if(res.ok){at=res.ret;where=res.ret.name+' in '+ZONES[z]+' ('+Math.round(pt.x)+','+Math.round(pt.y)+')';extra.place=res.ret.id}else where=ZONES[z]}
      else where=ZONES[z]}
    if(!lead&&by==='scripted'){const L=lore(p,a,!!(c.fit||c.fresh));if(!L){speakAs(p,c,pick(TALK_LINES.rumourNone),by);return {ok:true,mark:null}}lead=L.text;where=L.where||where}
    if(!lead)return no('a rumour needs about: the lead, written so the member can act on it');
    mark='[rumour]';hint='A lead from '+full(p)+': '+lead+(where?' (where: '+where+')':'');
    if(by==='scripted')speakAs(p,c,fill(pick(TALK_LINES.rumour),{lead}),by,mark);
    for(const b of mem)remember(b,'talk',full(p)+' told us: '+lead+(where?' ('+where+')':''));
    noteOn(p,'Told the Fellowship: '+lead)}
  else if(kind==='job'){const tpl=String(args.tpl||ROLE_JOB[p.role]||'rescue');if(!ADVENTURES[tpl]||tpl==='fallen')return no('tpl must be one of '+Object.keys(ADVENTURES).filter(k=>k!=='fallen').join(', '));
    const town=p.town&&CITY.some(x=>x.name===p.town&&x.fac===a.fac)?p.town:home.name;
    const giver=['captain','innkeeper','smith','quartermaster','priest','bard'].includes(p.role)?p.role:undefined;
    const z=args.region!=null&&args.region!==''?regionIdx(args.region):null;
    const res=pull('post_hook',{town,tpl,...(giver?{giver}:{}),forHero:a.id,...(z!=null?{region:z}:{}),reward:['small','fair','generous'].includes(args.reward)?args.reward:'fair',src:'request'},{by,reason:'a job from '+full(p)+' in conversation'});
    if(!res.ok)return no('the hook board said no: '+res.reason);
    extra.hook=res.ret.id;mark='[job posted]';hint=full(p)+' has a job for '+a.name+': '+(ADVENTURES[tpl].name||tpl)+' (job '+res.ret.id+' on the '+town+' board). list_jobs and take_adventure there.';
    if(by==='scripted')speakAs(p,c,fill(pick(TALK_LINES.job),{town}),by,mark);
    noteOn(p,'Offered '+a.name+' work: '+(ADVENTURES[tpl].name||tpl)+'.')}
  else if(kind==='combat'){const hurt=slotHeroes(slotted()).find(b=>living(b)&&b.hp<maxHp(b)*CONV.HURT&&(c.heroes.includes(b.id)||dist(b,p)<=CONV.HURT_R));
    if(hurt)return no(hurt.name+' of the Fellowship is badly hurt ('+Math.round(100*hurt.hp/maxHp(hurt))+'% HP): no fight now; let them walk away');
    const k=args.fight==='elite'?'elite':'ambush',frame=clean(args.frame,280)||full(p)+' gives a sharp whistle, and figures step out to bar the way.';
    const town=a.state==='town'?CITY.find(x=>x.name===(p.town||a.town))||home:null,gate=town?outsideGate(town):null; // no fight inside the walls: they wait outside the gate
    if(town&&!gate)return no('no open ground outside the '+town.name+' gate');
    const res=stageScene({kind:k,near:gate?gate.x.toFixed(1)+','+gate.y.toFixed(1):a.name,frame:frame.length>=12?frame:frame+' Steel is drawn.',title:clean(args.title,60)||undefined,cast:{...(args.foe?{foe:args.foe}:{}),...(args.level!=null?{level:args.level}:{})},reason:'a conversation with '+full(p)+' turned to blows'});
    if(!res.ok)return no('the scene was refused: '+String(res.error||res.reason||'').replace(/^Refused: /,''));
    extra.staged=res.staged;p.hostile=true;warm(p,-10,'turned on the Fellowship');mark='[combat]';hint=full(p)+' turns on you: '+frame+(gate?' They will be waiting outside the '+town.name+' gate.':'');
    noteOn(p,'Turned on the Fellowship.')}
  else if(kind==='blessing'){if(!['priest','hermit'].includes(p.role))return no('only a priest or a hermit gives blessings');if(p.mood==='hostile')return no(p.name+' will not bless them');
    const got=mem.filter(b=>!b.blessed&&dist(b,p)<=4);if(!got.length)return no('nobody near enough is without a blessing');
    for(const b of got)b.blessed=1;mark='[blessing]';hint=full(p)+' blesses '+got.map(b=>b.name).join(' and ')+': the next strike lands harder.';
    if(by==='scripted')speakAs(p,c,pick(TALK_LINES.blessing),by,mark);warm(p,1,'blessed them')}
  else if(kind==='hire'){if(p.hired!=null)return no(p.name+' is already hired');if(p.mood==='hostile')return no(p.name+' will not ride with the Fellowship (hostile)');
    if(!hireKind({...p,hireOffer:null}))return no(full(p)+' does not hire out (a sellsword, a drover or a guide does; so does anyone placed with a want of coin)');
    const std=priceFor({...p,hireOffer:null},a),want=Math.round(Number(args.price)),price=Number.isFinite(want)&&want>0?Math.max(1,Math.min(want,std*3)):std;
    p.hireOffer={conv:c.id,hero:a.id,price,until:Math.round(S.gameMin+HIRE.OFFER_MIN)};
    mark='[hire]';hint=full(p)+' offers their blade to '+a.name+' for '+price+' gold a day (1 to 5 days, paid up front): hire {npc:"'+p.name+'", days} while you stand near; the offer stands '+Math.round(HIRE.OFFER_MIN/60)+' game hours.';
    if(by==='scripted')speakAs(p,c,full(p)+' names a price: '+price+' gold a day.',by,mark);
    noteOn(p,'Offered their blade to '+a.name+' for '+price+' gold a day.')}
  else if(kind==='leave'){mark='[leaves]';hint=full(p)+' walks away from the conversation.';const sn=p.snub||(p.snub={});for(const id of c.heroes)sn[id]=Math.round(S.gameMin+CONV.SNUB_GM);
    if(by==='scripted'&&p.mood!=='hostile')speakAs(p,c,pick(TALK_LINES.leave),by,mark);
    warm(p,-1,'walked off');if(p.wander&&a){const dx=p.x-a.x,dy=p.y-a.y,n=Math.hypot(dx,dy)||1;p.stroll={x:p.x+dx/n*5,y:p.y+dy/n*5}}}
  c.offerEx=c.ex;c.offers.push({kind,ex:c.ex,by,mark});if(by==='dm-agent')d.offers++;T.stats.offers[kind]=(T.stats.offers[kind]||0)+1;
  // the mark on the person's last line (the chat panel shows it), the hint to every member in the conversation
  for(const b of mem){const e=(b.chat||[]).slice().reverse().find(x=>x.talk===c.id&&x.from&&x.from.id===p.id);if(e&&!e.mark)e.mark=mark;notify(b,mark+' '+hint,true,2)}
  log(['Follow-up from '+full(p)+' ',mark,by==='dm-agent'?' (DM agent)':'',': '+hint],{conv:c.id,npc:p.id,kind,by,mark,...extra});
  if(kind==='leave'||kind==='combat')close(c,kind==='combat'?'it came to blows':'they walked off');
  const esc=kind==='job'&&escHook?escHook(c,p,a,{offer:kind,hook:extra.hook}):null; // an offer that needs an answer (#407)
  return {ok:true,kind,mark,hint,...extra,mood:p.mood,...(esc?{table:esc.note}:{})}}

// A spot of open ground just past the clear ground outside a town's gate (away from the town's centre).
function outsideGate(c){const cx=(c.x0+c.x1+1)/2,cy=(c.y0+c.y1+1)/2,dx=c.gate.x-cx,dy=c.gate.y-cy,n=Math.hypot(dx,dy)||1;
  for(let d=LK.TOWN_CLEAR+.5;d<=LK.TOWN_CLEAR+6;d++){const q={x:c.gate.x+dx/n*d,y:c.gate.y+dy/n*d};if(!spotErr(q))return q}return null}
const regionIdx=v=>{if(Number.isInteger(v)&&v>=0&&v<ZONES.length)return v;const s=String(v).trim().toLowerCase();if(/^\d+$/.test(s)){const n=Number(s);return n<ZONES.length?n:null}
  const i=ZONES.findIndex(n=>n.toLowerCase()===s);return i>=0?i:null};
// What the person knows (for the DM, and the scripted rumours): news of their town, danger and conditions near, places, the elite of the member's hunting ground.
function knows(p,a){const out=[],z=Number.isFinite(p.x)?zoneAt(p.x,p.y):null;
  for(const it of (S.npcNews&&S.npcNews.items)||[])out.push({text:it.hero+' slew '+it.elite+' in '+it.zone+'.'});
  for(const m of S.marks||[])if(m.kind==='danger')out.push({text:'The road around '+Math.round(m.x)+','+Math.round(m.y)+' in '+ZONES[m.z]+' has turned dangerous.',where:ZONES[m.z]});
  for(const cnd of S.conditions||[])out.push({text:cnd.kind+' over '+ZONES[cnd.z]+'.',where:ZONES[cnd.z]});
  for(const q of S.places||[])out.push({text:'There is '+q.name+' out in '+ZONES[q.z]+', at '+Math.round(q.x)+','+Math.round(q.y)+'.',where:ZONES[q.z]});
  if(a){const w=npcWarning(a);if(w)out.push({text:w,warn:true})}
  if(a){const hz=huntZone(a),E=ELITES[hz];if(E&&E.name)out.push({text:'They say '+E.name+' prowls '+ZONES[hz]+'. Few who meet it come home whole.',where:ZONES[hz]})}
  if(z!=null&&z>=0)out.sort((x,y)=>(y.where===ZONES[z])-(x.where===ZONES[z]));
  out.sort((x,y)=>(y.warn?1:0)-(x.warn?1:0)); // a warning to a green blade comes first (#188)
  return out.slice(0,5)}
// fit: a warning to a green blade comes only on a first meeting or when the question was about the danger (#540); else it is left out.
function lore(p,a,fit=true){const L=knows(p,a).filter(x=>fit||!x.warn);return L.length?L[0].warn?L[0]:L[Math.floor(r()*L.length)]:null}

// ---- the scripted answer reads the question (#540) ----
// Public knowledge only: the placed people (S.npcs, wanderers) as the town sees them, the regions, towns, landmarks and
// markers in the world, and the posted board. Never the DM's notes, a person's want, their record or a campaign secret.
// Keyword matching, no model, no RNG. Returns {text, fit} or null when the line asks for nothing it can answer.
const JOBQ=/\b(quests?|jobs?|work|bount(?:y|ies)|tasks?|board|adventures?|contracts?|hiring)\b/i,CRYPTQ=/\b(crypt|dungeon|tomb|catacombs?|stair|undercroft)\b/i;
const DIRS=['east','south-east','south','south-west','west','north-west','north','north-east'];
const dirTo=(f,t)=>DIRS[((Math.round(Math.atan2(t.y-f.y,t.x-f.x)/(Math.PI/4))%8)+8)%8];
const wayTo=(p,t)=>{const d=Math.round(dist(p,t));return d<4?'close by':dirTo(p,t)+' of here, about '+d+' tiles'};
const nearestOf=(p,z)=>{let b=null,bd=1e9;for(const q of ZPTS[z]||[]){const d=dist(p,q);if(d<bd){bd=d;b=q}}return b};
const nmRe=n=>new RegExp('\\b'+String(n).toLowerCase().replace(/[^a-z0-9 ]/g,'.')+'\\b');
const STOP=new Set(['i','the','a','an','crypt','gate','captain','inn','board','north','south','east','west','do','is','are','can','what','where','who','any','have','has','tell','know']);
function townAnswer(p,a,text){const raw=String(text||''),t=raw.toLowerCase();if(t.length<3)return null;
  const parts=[];let fit=false;const here=p.town||(homeOf(a)&&homeOf(a).name)||'town';
  const hit=[];
  for(const q of people()){if(q===p)continue;const first=String(q.name||'').split(' ')[0].toLowerCase();
    if(nmRe(q.name).test(t)||(first.length>=4&&nmRe(first).test(t)))hit.push(q)}
  for(const q of hit.slice(0,1)){const where=q.town?(q.town===p.town?wayTo(p,q):'in '+q.town+', '+wayTo(p,q)):'last seen around '+(ZONES[zoneAt(q.x,q.y)]||'the wilds');
    parts.push(full(q)+'? '+where+'.')}
  const pl=[];
  ZONES.forEach((n,z)=>{if(nmRe(n).test(t))pl.push({name:n,z,at:nearestOf(p,z)})});
  for(const c of CITY)if(c.name!==p.town&&nmRe(c.name).test(t))pl.push({name:c.name,at:{x:(c.x0+c.x1)/2,y:(c.y0+c.y1)/2}});
  for(const l of LANDMARKS)if(!(CRYPT&&l.name===CRYPT.name)&&nmRe(l.name.replace(/^the /i,'')).test(t))pl.push({name:l.name,at:l,z:zoneAt(l.x,l.y)});
  for(const m of S.places||[])if(m.name&&nmRe(m.name).test(t))pl.push({name:m.name,at:m,z:m.z});
  for(const g of pl.slice(0,1)){learnPlace(a,g.name,'told');
    parts.push(g.name+' lies '+(g.at?wayTo(p,g.at):'a way off')+(g.z!=null&&ZONES[g.z]&&g.name!==ZONES[g.z]?', in '+ZONES[g.z]:'')+(g.z!=null&&g.name===ZONES[g.z]?'; '+jobRumour(a,g.z):'')+'.')}
  if(CRYPTQ.test(t)||(CRYPT&&nmRe(CRYPT.name.replace(/^the /i,'')).test(t))){fit=true;
    const cw=p.role==='captain'?captainWarning(a):null;
    parts.push(cw||((CRYPT?CRYPT.name:'The Crypt')+' lies '+(CRYPT?wayTo(p,CRYPT):'far off')+'. Tried blades go down together, or not at all.'));
    if(CRYPT)learnPlace(a,CRYPT.name,'told')}
  // a name nobody here knows: a capitalised run in the middle of the line
  const known=new Set([a.name,p.name,...people().flatMap(q=>[q.name,String(q.name||'').split(' ')[0]]),...(S.agents||[]).map(b=>b.name),...ZONES,...CITY.map(c=>c.name),...LANDMARKS.map(l=>l.name),CRYPT&&CRYPT.name].filter(Boolean).flatMap(x=>String(x).split(' ')).map(x=>x.toLowerCase()));
  if(!hit.length&&!pl.length&&!(CRYPTQ.test(t))){const runs=[];let cur=[];
    for(const m of raw.matchAll(/[A-Za-z][A-Za-z'-]*/g)){const w=m[0],i=m.index,before=raw.slice(0,i).trimEnd(),start=!before||/[.!?]$/.test(before),lw=w.toLowerCase();
      const cap=/^[A-Z]/.test(w)&&!known.has(lw)&&!STOP.has(lw)&&(!start||cur.length);
      if(cap)cur.push(w);else{if(cur.length)runs.push(cur.join(' '));cur=[]}}
    if(cur.length)runs.push(cur.join(' '));
    const nm=runs[0];
    if(nm)parts.push(p.role==='innkeeper'?'Never heard of '+nm+', and I hear most things. Ask at the gate.':'Never heard of '+nm+'. Try the inn, they hear everything.')}
  if(JOBQ.test(t)){const mine=(S.adventures||[]).filter(h=>h.phase==='open'&&h.town===here&&(h.for==null||h.for===a.id));
    for(const h of mine)learnJob(a,h);
    const names=mine.slice(0,4).map(h=>{const T=ADVENTURES[h.tpl];return (T&&T.name||h.tpl)+(h.zone!=null&&ZONES[h.zone]?' ('+ZONES[h.zone]+')':'')});
    parts.push(names.length?'On the '+here+' board: '+names.join('; ')+'. Ask at the gate.':'Nothing posted at '+here+' just now. The board fills every few hours.')}
  return parts.length?{text:parts.join(' '),fit}:null}
export const publicAnswer=townAnswer; // for the townsperson who answers a hero that is not in the Fellowship (sim/player.js talk)

// ---- trade with a person (the buy and sell tools with npc) ----
export function stockOf(p){return ROLE_STOCK[p.role]||DEFAULT_STOCK}
const buyMul=p=>Math.max(.7,1-(p.warmth||0)*.02)*(p.town?1:1.1),sellMul=p=>Math.min(1.3,1+(p.warmth||0)*.02)*(p.town?1:.9);
const priceWord=p=>{const m=buyMul(p);return m<.97?'kind':m>1.03?'steep':'fair'};
// What person p charges for a thing whose town price is base (a supply's USES price, or SHOP_COST(level) for gear): the one
// price rule npcBuy and the shop tool share (#425).
export const tradePrice=(p,base)=>Math.ceil(base*buyMul(p));
// The person a member trades with: named, or the one trade open within reach. Returns p or {error}.
export function traderFor(a,name,range){const s=String(name==null?'':name).trim().toLowerCase();
  const open=people().filter(p=>p.trade&&p.trade.until>S.gameMin&&(s?String(p.id)===s||String(p.name).toLowerCase()===s||full(p).toLowerCase()===s||p.role===s:true));
  if(!open.length)return s?{error:'Nobody called "'+name+'" has offered to trade with you. Talk to them first.'}:null;
  const p=open.sort((x,y)=>dist(a,x)-dist(a,y))[0];if(dist(a,p)>range)return {error:full(p)+' is too far away to trade ('+Math.round(dist(a,p))+' tiles).'};
  if(!inSlots(a)||p.trade.fac!==a.fac)return {error:full(p)+' trades only with the Fellowship.'};
  return p}
export function npcBuy(a,p,{slot,item,count}){const st=stockOf(p);
  if(item!=null&&item!==''){const id=Object.keys(USES).find(x=>x.toLowerCase()===String(item).toLowerCase());
    const sells=st.filter(x=>x!=='gear'&&USES[x]&&USES[x].lvl<=a.lvl);
    if(!id||!st.includes(id))return {error:full(p)+' does not sell that. On offer: '+(sells.map(x=>x+' ('+tradePrice(p,USES[x].price)+'g)').join(', ')||'no supplies')+(st.includes('gear')?', and gear for your level (pass slot)':'')+'.'};
    const U=USES[id],price=tradePrice(p,U.price);if(U.lvl>a.lvl)return {error:id+' is sold from level '+U.lvl+'.'};if(a.gold<price)return {error:'That costs '+price+'g each; you have '+a.gold+'g.'};
    if(U.kind==='pack'){if(invOf(a).pack)return {error:'You already carry a Wayfarer\'s Pack.'};a.gold-=price;invOf(a).pack=1;tradeDone(p,a,id);return {ok:true,bought:id,from:full(p),cost:price,gold:a.gold,capacity:capOf(a)}}
    const n=Math.min(10,Math.max(1,Math.round(Number(count)||1)));let got=0;while(got<n&&a.gold>=price&&addUse(a,id,1)){a.gold-=price;got++}
    if(!got)return {error:'Your pack is full ('+used(a)+'/'+capOf(a)+').'};tradeDone(p,a,id+' x'+got);return {ok:true,bought:id+' x'+got,from:full(p),cost:got*price,gold:a.gold}}
  if(!st.includes('gear'))return {error:full(p)+' sells no gear. Pass item: '+st.filter(x=>USES[x]).join(', ')+'.'};
  const k=slot?String(slot):weakestSlot(a);if(!k||!SLOTS.includes(k))return {error:'No slot to fill.'};
  const cur=a.slots[k];if(cur&&cur.epic)return {error:'An epic holds that slot.'};if(slotLevel(a,k)>=a.lvl)return {error:'Nothing better than your '+(cur?cur.name:'gear')+' is on offer at your level.'};
  const cost=tradePrice(p,SHOP_COST(a.lvl));if(a.gold<cost)return {error:'That costs '+cost+'g; you have '+a.gold+'g.'};
  refreshEpics(a);a.gold-=cost;const it=makeItem(a.cls,k,a.lvl,zoneFor(a.lvl),{src:'Bought from '+full(p),rare:0});const old=equip(a,it);if(old)addGear(a,old);a.hp=Math.min(a.hp,maxHp(a));
  tradeDone(p,a,it.name);const s2=itemStats(it);
  return {ok:true,bought:it.name+' (ilvl '+it.ilvl+': '+Object.keys(s2).map(x=>'+'+s2[x]+' '+x).join(' ')+')',from:full(p),cost,gold:a.gold,replaced:old?old.name+' (now in your pack)':null}}
export function npcSell(a,p,{index}){const m=sellMul(p);let tot=0,n=0;
  if(index!=null){const i=Number(index);if(!(i>=0&&i<used(a)))return {error:'No pack entry '+index+'.'};tot=sellEntry(a,i);if(tot<0)return {error:'That cannot be sold (consumables and quest items are kept).'};n=1}
  else{const s=sellLoot(a);tot=s.gold;n=s.n}
  if(!n)return {error:'Nothing to sell.'};const g=Math.round(tot*m);a.gold+=g;tradeDone(p,a,n+' item'+(n>1?'s':'')+' sold');return {ok:true,sold:n,to:full(p),gold_gained:g,gold:a.gold}}
function tradeDone(p,a,what){const c=p.trade&&convById(p.trade.conv);if(!p.tradeWarm||p.tradeWarm!==p.trade.conv){p.tradeWarm=p.trade.conv;warm(p,1,'a fair trade')}
  log([a.name+' trades with '+full(p)+': ',what,'.'],{npc:p.id,hero:a.id,trade:what,...(c?{conv:c.id}:{})})}

// ---- the DM's view: the waiting call ----
export function legalOffers(c,p){const out=[];if(p.mood!=='hostile')out.push('trade');out.push('rumour','job');
  const hurt=slotHeroes(slotted()).some(b=>living(b)&&b.hp<maxHp(b)*CONV.HURT&&(c.heroes.includes(b.id)||dist(b,p)<=CONV.HURT_R));if(!hurt)out.push('combat');
  if(['priest','hermit'].includes(p.role)&&p.mood!=='hostile')out.push('blessing');
  if(p.hired==null&&p.mood!=='hostile'&&hireKind({...p,hireOffer:null}))out.push('hire');out.push('leave');return out}
function convView(c,withCall){const p=npcById(c.npc);if(!p)return null;const a=hero(c.wait?c.wait.hero:c.heroes[c.heroes.length-1]);
  const T=talkOf(p),want=p.want||T.want;
  return {conv:c.id,...(withCall&&c.wait?{call:c.wait.call,seconds_left:Math.max(0,Math.round((waitEnd(c.wait)-Date.now())/100)/10)}:{}),waiting:!!c.wait,
    npc:{id:p.id,name:full(p),role:p.role,faction:p.fac===0||p.fac===1?FAC[p.fac].name:'neutral',where:p.town||ZONES[zoneAt(p.x,p.y)]||'the wilds',want,mood:recordOf(p,a)&&p.mood,warmth:p.warmth,
      ...(p.hireOffer&&S.gameMin<p.hireOffer.until?{hire_offer:{price:p.hireOffer.price,until:Math.round(p.hireOffer.until)}}:{}),...(p.hired!=null?{hired:true}:{}),
      ...(withCall?{knows:knows(p,a).map(x=>x.text),record:recordView(p)}:{})},
    member:a?{id:a.id,name:a.name,cls:a.cls,lvl:a.lvl,role:slotKeyOf(a)||null,...(c.read&&c.read[a.id]!=null?{read_them:c.read[a.id]}:{}),...(lastTime(p,a)?{last_time:lastTime(p,a)}:{})}:null, // last_time: what the person remembers of them (#571)
    line:c.wait?c.wait.line:null,so_far:c.lines.slice(-12).map(l=>l.name+': '+l.text+(l.mark?' '+l.mark:'')),exchange:exText(c),
    ...(withCall?{offers:legalOffers(c,p),offered_this_exchange:c.offerEx===c.ex}:{}),
    ...(withCall&&a&&rumoursFor(p,a).length?{word_to_pass_on:rumoursFor(p,a).map(r=>r.text),word_note:'What the town is saying, which '+p.name+' passes on: weave it into the answer in their voice if it fits; the game adds it after your answer if you leave it out.'}:{})}}
// npc_call: the oldest conversation waiting for the DM, with everything needed to answer it.
export function npcCall(){const T=S.talks;const c=T&&T.cur.find(x=>x.state==='open'&&x.wait);
  if(c&&c.wait.seen==null&&c.wait.real)c.wait.seen=Date.now(); // the budget starts at pickup (#680)
  if(!c)return {ok:true,call:null,open:T?T.cur.filter(x=>x.state==='open').map(x=>convView(x,false)).filter(Boolean):[]};
  return {ok:true,call:convView(c,true),how:'Answer as the person: npc_say {npc, conv, text} (their own voice, as much as the moment needs; usually a few sentences), then at most one npc_offer {npc, kind} from offers. Silence is answered by the scripted DM.'}}
// For dm_status: conversations open now, the waiting ones first (must answer).
export function convSummary(){const T=S.talks;if(!T)return [];return T.cur.filter(c=>c.state==='open').sort((x,y)=>!!y.wait-!!x.wait).map(c=>{const p=npcById(c.npc),a=hero(c.wait?c.wait.hero:c.heroes[c.heroes.length-1]);
  return {conv:c.id,npc:p?full(p):c.name,npc_id:c.npc,member:a?a.name:null,waiting:!!c.wait,line:c.wait?c.wait.line:null,exchange:exText(c)}})}

// ---- end ----
function close(c,why){if(c.state==='done')return;c.state='done';c.wait=null;c.why=why;const T=talkState(),p=npcById(c.npc);
  T.cur.splice(T.cur.indexOf(c),1);T.past.unshift({id:c.id,npc:c.npc,name:c.name,heroes:c.heroes.slice(),lines:c.lines.length,offers:c.offers.map(o=>o.kind),why,day:gameDay()+1});if(T.past.length>CONV.PAST_KEEP)T.past.pop();
  const what=c.offers.length?' ('+c.offers.map(o=>o.mark).join(' ')+')':'';
  for(const id of c.heroes){const b=hero(id);if(living(b))remember(b,'talk','Talked with '+c.name+what+'.')}
  if(p){const H=p.hmem||(p.hmem={});for(const id of c.heroes){const said=[...c.lines].reverse().find(l=>l.who==='member'&&l.id===id),m=H[id]||{n:0};
      H[id]={n:m.n+1,gm:Math.round(S.gameMin),said:said?clean(said.text,120):m.said||null,what:c.offers.length?c.offers.map(o=>o.kind).join(', '):m.what||null}}
    const ks=Object.keys(H);if(ks.length>CONV.HMEM_KEEP){ks.sort((x,y)=>H[x].gm-H[y].gm);for(const k of ks.slice(0,ks.length-CONV.HMEM_KEEP))delete H[k]}} // townsfolk remember each hero (#571)
  log(['Conversation with '+c.name+' ends: '+why+what+'.'],{conv:c.id,npc:c.npc,end:why})}

// After a talk scene at the table (#407): the person answers the company's choice. With the DM agent listening the answer is
// its to voice (the call waits like any other; `fill` is spoken if it stays silent); else the scripted line now. A closed
// conversation gets the scripted line at once.
export function sceneReply(c,p,a,what,fill){const t=clean(fill,CONV.DM_LINE_MAX);const ms=c.state==='open'&&a?dmBudget():0;
  if(ms>0){const T=talkState();c.wait={call:++T.call,hero:a.id,line:'(at the table: '+clean(what,CONV.LEAD_MAX)+')',gm:Math.round(S.gameMin),real:Date.now(),ep:goneEpoch(),ms,by:ms===CONV.TURN_MS?'turn':'voice',fill:t};return 'dm'}
  if(t)speakAs(p,c,t,'scripted');return 'scripted'}
export function endTalk(c,why){close(c,why)}

// A staged meeting or social scene ended with the person still there: the members' next words continue it (#132).
export function talkFromScene(w,ids,line){if(!w||!slotted())return null;const T=talkState();if(convWith(w))return convWith(w);
  const hs=(ids||[]).map(hero).filter(b=>living(b)&&inSlots(b));if(!hs.length)return null;
  const c={id:++T.seq,npc:w.id,name:full(w),heroes:hs.map(b=>b.id),lines:line?[{who:'npc',id:w.id,name:full(w),text:clean(line,CONV.LINE_MAX),t:clockStr(),by:'scene'}]:[],ex:0,wait:null,offers:[],offerEx:-1,state:'open',born:Math.round(S.gameMin),last:Math.round(S.gameMin)};
  T.cur.push(c);T.stats.opened++;recordOf(w,hs[0]);w.fmem.talks++;w.fmem.last=Math.round(S.gameMin);
  log(['Conversation: the scene with '+full(w)+' leaves the way open for words.'],{conv:c.id,npc:w.id,open:true,from:'scene'});return c}

// ---- once per step (sim/index.js): timeouts and lapses. Nothing to do without a conversation. ----
export function talkTick(){const T=S.talks;if(!T)return;
  for(const c of T.cur.slice()){const p=npcById(c.npc);
    if(!p){close(c,'they are gone');continue}
    if(c.wait){const live=!(goneEpoch()>(c.wait.ep|0))&&(Date.now()<waitEnd(c.wait))&&today().lines<CONV.DM_LINES_PER_DAY&&S.gameMin-c.wait.gm<CONV.WAIT_GM;
      if(!live){const a=hero(c.wait.hero);if(c.wait.fill){T.stats.scripted++;speakAs(p,c,c.wait.fill,'scripted');afterAnswer(c,p)}else if(living(a))scripted(c,p,a);else close(c,'nobody is left to answer');continue}}
    const near=c.heroes.map(hero).filter(b=>living(b)&&dist(b,p)<=CONV.LEAVE_R);
    if(!near.length)close(c,'the Fellowship moved on');
    else if(!c.wait&&S.gameMin-c.last>CONV.IDLE_GM)close(c,'the talk ran out')}
  for(const p of [...(S.npcs||[]),...(S.wanderers||[])])if(p.trade&&p.trade.until<=S.gameMin)delete p.trade}

// What an agent-played hero has said and heard (owner's screenshot, with issue #163): members of a local-model
// Fellowship kept introducing themselves to each other and asking the same question twice, because their trimmed
// or fresh context no longer held what had been said. Owned by brain-builder. DOM-free, no RNG, agent heroes only
// (scripted speech never comes through here, so the headless sim is unchanged).
//   lineRefusal(a, text)   null, or the error the agent sees for a line it should not say again
//   noteSaid(a, text, L)   after an agent line: remember it, and that the listeners L heard a
//   metNames(a)            companions a has met: both have spoken in each other's hearing
//   heardLines(a, n)       the last n party and aloud lines a heard (its own marked), compact

export const TALK={SAME:.8,LAST:5,HEARD:8,CUT:120};
const words=s=>new Set(String(s||'').toLowerCase().replace(/[^a-z0-9 ]+/g,' ').split(' ').filter(x=>x.length>2));
// shared words over the larger set: 1 for the same words in any order
export function sameness(x,y){const A=words(x),B=words(y);if(!A.size||!B.size)return 0;let n=0;for(const w of A)if(B.has(w))n++;return n/Math.max(A.size,B.size)}
// "Hello Aelett! I am Gwilett from Wendell's Ford, a Tarrow Rogue ..." : the speaker's own name with an introduction
export function isIntro(a,text){const t=String(text||''),first=String(a.name||'').split(' ')[0];
  if(!first||!new RegExp('\\b'+first.replace(/[^\w]/g,'')+'\\b','i').test(t))return false;
  return /\b(i am|i'm|my name|call me|introduce|nice to meet|pleased to meet)\b/i.test(t)}
const byId=id=>S.agents.find(x=>x.id===id)||null;
export function metIds(a){const h=a.talkHeard||{};return Object.keys(h).map(Number).filter(id=>{const b=byId(id);return b&&b.state!=='dead'&&(b.talkHeard||{})[a.id]})}
export const metNames=a=>metIds(a).map(id=>byId(id).name);
export const MSG_SAME='You already said that; say something new or act (propose, vote, lead_to, or answer a question you were asked).';
export const MSG_INTRO='You have already met your companions; no need to introduce yourself again. Say something new or act (propose, vote, lead_to, or answer a question you were asked).';
export function lineRefusal(a,text){if(!a||!a.player)return null;
  if((a.talkSaid||[]).some(s=>sameness(s,text)>=TALK.SAME))return MSG_SAME;
  if(isIntro(a,text)&&metIds(a).length)return MSG_INTRO;
  return null}
export function noteSaid(a,text,listeners){if(!a||!a.player)return;spokenAbout(a,text);const L=a.talkSaid||(a.talkSaid=[]);L.push(String(text).slice(0,200));if(L.length>TALK.LAST)L.shift();
  for(const b of listeners||[])if(b&&b!==a&&b.kind==='hero'){(b.talkHeard||(b.talkHeard={}))[a.id]=1;noteKnownAt(b,a);noteKnownAt(a,b)}
  if(saidHook)try{saidHook(a,text,listeners)}catch(e){}} // a companion of its company may answer (#764, sim/compvoice.js)
let saidHook=null;export function setSaidHook(f){saidHook=typeof f==='function'?f:null}
export function heardLines(a,n=TALK.HEARD){const cut=t=>t.length>TALK.CUT?t.slice(0,TALK.CUT-1)+'…':t;
  return (a.chat||[]).filter(e=>e.from&&(e.party||e.trigger==='agent'||e.from.kind==='hero'||e.whisper||e.emote)).slice(-n)
    .map(e=>e.t+' '+(e.from===a?'(you)':e.from.name||'?')+(e.party?' [party]':'')+(e.whisper?' [whispered]':'')+': '+(e.emote?'*':'')+cut(String(e.text||''))+(e.emote?'*':''))}
