// The companion voice (issue #764): a scripted hero who rides with an agent company (a hire, a companion who answered an
// invite, any scripted member of a company with an agent in it) is voiced by the DM, like a companion NPC at a D&D table,
// instead of the fixed camp table: an agent who hears the same "you snore like a collapsing barn" twice knows the hero is
// scripted. Owned by brain-builder. DOM-free, no sim RNG (picks by hash), only touches heroes of companies that hold an
// agent, so a seeded world (npm run sim, the hash checks) is unchanged.
//
//   when    the camp's talk picks a line for such a hero (sim/camp.js), it answers a quarrel, an agent says or shouts a line
//           that names it (or any line within COMP.NEAR tiles when only the two are there), or an agent talks to it (talk)
//   voice   a must-answer call to the DM (companion_call: the companion's card, the day's events, the last lines it heard, what
//           it already said to each listener, the agent's words for a reply); the DM's voice answers with companion_say. The
//           game waits while that voice polls (COMP.VOICE_MS, or its budget_s), then the DM's reflex fills it (#561)
//   fill    a row of the camp table (or the reply rows) that this listener has not heard from this companion, until all are
//           used; rows that need something that did not happen today (data/camp.js CAMP_NEEDS) are left out; the fill is logged
//   memory  a.cvoice[listenerId] = {said:[{d, t, text}] (last COMP.KEEP), rows:['topic:i' heard]} on the companion, saved with it
//   budget  COMP.PER_DAY lines a companion a game day (replies included), COMP.DM_PER_DAY across all of them; past it the companion
//           keeps quiet. dm_status shows `companions`
//   rules   agent heroes never get a voiced or scripted line here; the DM's words are cut of quotes put in a living agent's mouth
//           (sim/spokefor.js, #750); hero tools hear the line as the companion's, never that the DM spoke it (e.comp, e.dm and
//           e.by are for the watcher's Chat tab only). DM log kind 'companion': the companion's name and line, never the hero's
// State S.compVoice {seq, cur:[call], day:{d, n:{heroId:count}, total}, stats}, saved with the world.
import {S,clockStr,dayNo} from './state.js';
import {swornOf} from './oath.js';
import {hash} from '../core/rng.js';
import {ZONES,zoneAt,dist} from '../world/map.js';
import {homeOf} from '../data/races.js';
import {CAMP_LINES,TOPICS,QUARREL_REPLY,CAMP_NEEDS,COMP_REPLY} from '../data/camp.js';
import {companyOf,members} from './company.js';
import {partySay} from './council.js';
import {speak} from './chat.js';
import {dmlog} from './dmlog.js';
import {since,dmAlive,goneEpoch,callDeadline,lateWhy} from './dmreflex.js';
import {spokeFor,spokeNote} from './spokefor.js';
import {notEnglish} from './lang.js';
import {sameness,heardLines,setSaidHook} from './talk.js';
import {remember} from './memory.js';

export const COMP={
  PER_DAY:6,          // lines a companion speaks a game day, replies included
  DM_PER_DAY:36,      // ... all companions together (the DM's own daily share)
  KEEP:20,            // lines a companion remembers saying to each listener
  NEAR:4,             // tiles: any line said this close, with nobody else near, is said to the companion
  LINE_MAX:300,       // the DM's line (a companion speaks briefly)
  VOICE_MS:8000,      // real ms the game waits while the companion voice polls
  VOICE_MIN:4000,VOICE_MAX:30000, // the range companion_call {budget_s} may ask for
  POLL_MS:10000,      // real ms: a companion_call poll this recent counts as the voice listening
  GRACE_MS:12000,     // real ms for a DM runner alive but not polling (queued behind other calls)
  WAIT_GM:90,         // game minutes a call may wait at most
  OPEN_MAX:6,         // calls waiting at once (more are filled at once)
  SAME:.8,            // a line this close to one the companion already said to that listener is refused
};
const DAY=1440;
const hero=id=>S.agents.find(x=>x.id===id)||null;
const alive=a=>!!a&&a.kind==='hero'&&a.state!=='dead';
const clean=(s,n)=>String(s==null?'':s).replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,n);
const txt=ps=>(ps||[]).map(p=>typeof p==='string'?p:p&&p.kind==='hero'?p.name||'?':p&&p.t!=null?p.t:'').join('');
const gameDay=()=>Math.floor(S.gameMin/DAY);

// ---- who is voiced ----
// A scripted hero in a company that holds a living agent: the DM speaks for it.
export function voiced(a){if(!a||a.kind!=='hero'||a.player||a.state==='dead'||a.state==='ghost')return false;
  const C=companyOf(a);return !!C&&members(C).some(b=>b.player&&b.state!=='dead')}
function state(){return S.compVoice||(S.compVoice={seq:0,cur:[],day:{d:-1,n:{},total:0},stats:{voiced:0,scripted:0,late:0,refused:0,cut:0,replies:0,silent:0}})}
function today(){const V=state();if(V.day.d!==gameDay())V.day={d:gameDay(),n:{},total:0};return V.day}
const spent=a=>today().n[a.id]||0;
const capped=a=>spent(a)>=COMP.PER_DAY||today().total>=COMP.DM_PER_DAY;
function memOf(a,lid){const M=a.cvoice||(a.cvoice={});return M[lid]||(M[lid]={said:[],rows:[]})}

// ---- the DM listening ----
let pollAt=0,voiceMs=0;
export function compHeard(args){pollAt=Date.now();const b=Number(args&&args.budget_s);voiceMs=Number.isFinite(b)&&b>0?Math.max(COMP.VOICE_MIN,Math.min(COMP.VOICE_MAX,b*1000)):0}
// Real ms to wait for the DM's voice, or 0: nobody listening, the reflex speaks at once (a world no runner spoke to never waits).
function budget(){const p=pollAt?Date.now()-pollAt:Infinity;if(p<COMP.POLL_MS)return voiceMs||COMP.VOICE_MS;
  return dmAlive()&&since('act')<90000?COMP.GRACE_MS:0}

// ---- what happened today, for the table's needs ----
function factsOf(a){const C=companyOf(a),d=gameDay(),f={};
  const L=C&&C.log?C.log.filter(e=>Math.floor((e.gameMin||0)/DAY)===d):[];
  if(L.some(e=>/ambush|slay|slew|slain|fight|fought|fell|kill|crypt|raid|blows|elite/i.test(txt(e.parts))))f.fight=1;
  if(C&&C.camp&&C.camp.stats&&C.camp.stats.camps>1)f.camp=1;
  return f}
const okRow=(k,F)=>{const n=CAMP_NEEDS[k];return !n||!!F[n]};

// ---- the reflex: a row nobody listening has heard from this companion ----
function rowsFor(c){if(c.trigger==='camp'){const t=TOPICS.includes(c.topic)?c.topic:TOPICS[0],out=[];
    for(const tp of [t,...TOPICS.filter(x=>x!==t)])CAMP_LINES[tp].forEach((s,i)=>out.push({k:tp+':'+i,s}));return out}
  const L=c.trigger==='quarrel'?QUARREL_REPLY:COMP_REPLY,p=c.trigger==='quarrel'?'qr:':'re:';return L.map((s,i)=>({k:p+i,s}))}
const fillT=(s,sp,o,zone)=>String(s).replace(/\{(\w+)\}/g,(m,k)=>k==='other'?(o?o.name:'friend'):k==='zone'?zone||'the wilds':k==='town'?homeOf(sp).name:m);
export function fillLine(c){const sp=hero(c.comp);if(!sp)return null;const F=factsOf(sp);
  const L=c.to.map(hero).filter(b=>alive(b)&&b.player);
  let rows=rowsFor(c).filter(r=>okRow(r.k,F));if(!rows.length)rows=rowsFor(c);
  const camp=c.trigger==='camp',head=camp?rows.filter(r=>r.k.startsWith((c.topic||'')+':')).length:rows.length;
  const start=Math.floor(hash(c.gm,sp.id,13)*Math.max(1,head))%Math.max(1,head);
  const order=[...rows.slice(start),...rows.slice(0,start)];
  // a listener who has heard every row starts over (only then may a row come back to them)
  for(const b of L){const m=memOf(sp,b.id);if(rows.every(r=>m.rows.includes(r.k)))m.rows=m.rows.filter(k=>!rows.some(r=>r.k===k))}
  const row=order.find(r=>L.every(b=>!memOf(sp,b.id).rows.includes(r.k)))||order.find(r=>L.some(b=>!memOf(sp,b.id).rows.includes(r.k)))||order[0];
  for(const b of L){const m=memOf(sp,b.id);if(!m.rows.includes(row.k))m.rows.push(row.k)}
  const other=hero(c.from)||L[0]||c.to.map(hero).find(alive)||null;
  return {text:fillT(row.s,sp,other,c.zone),row:row.k}}

// ---- speaking ----
function deliver(c,text,by,o={}){const sp=hero(c.comp);if(!alive(sp))return null;const V=state();
  let e=null;
  if(c.how!=='say'){const n=partySay(sp,text);if(typeof n!=='string')e=sp.chat&&sp.chat[sp.chat.length-1]}
  if(!e)e=speak(sp,text,'companion');
  if(e&&e.from===sp){e.comp=true;e.dm=true;e.by=by} // the watcher's Chat tab only: heroes hear the companion, never who spoke for it
  const d=dayNo(),t=clockStr();
  for(const b of c.to.map(hero))if(alive(b)&&b.player){const m=memOf(sp,b.id);m.said.push({d,t,text:clean(text,160)});if(m.said.length>COMP.KEEP)m.said.shift()}
  remember(sp,c.trigger==='camp'?'camp':'talk',(c.trigger==='camp'?'Round the fire I said: "':'I answered '+(hero(c.from)||{name:'them'}).name+': "')+clean(text,120)+'"');
  if(by==='dm-agent')V.stats.voiced++;else{V.stats.scripted++;if(o.why==='slow')V.stats.late++}
  if(c.trigger==='reply'||c.trigger==='talk')V.stats.replies++;
  dmlog('companion',null,[sp.name+(by==='dm-agent'?' (DM agent)':'')+(c.trigger==='camp'?' at the fire':c.trigger==='quarrel'?' answers back':' answers')+': "',text,'"'],
    {companion:sp.id,name:sp.name,trigger:c.trigger,by,...(o.row?{row:o.row}:{}),...(by==='scripted'?{fill:true,why:o.why||'gone',...(o.why==='slow'?{late:lateWhy(c.seen)}:{})}:{}),...(o.cut?{spoke_for:o.cut}:{})},{heroes:[]});
  return e}
function fill(c,why){const f=fillLine(c);if(!f)return null;deliver(c,f.text,'scripted',{why,row:f.row});return f.text}

// compLine(sp, {to, trigger, topic, from, line, how, zone}): sp's next line, voiced by the DM or filled by its reflex.
//   to       the heroes it speaks to (only agent listeners are remembered)
//   trigger  'camp' (topic from data/camp.js TOPICS), 'reply' (from said line to it), 'talk' (the talk tool), 'quarrel'
//   how      'party' (a shout to the company, the default) or 'say' (aloud in earshot)
// -> null (sp is not voiced: the caller keeps its own line), {said:'silent'} (over the day's budget), {said:'dm', call}, or
//    {said:'scripted', text}.
export function compLine(sp,o={}){if(!voiced(sp))return null;const V=state(),d=today();
  if(capped(sp)){V.stats.silent++;return {said:'silent'}}
  d.n[sp.id]=(d.n[sp.id]||0)+1;d.total++;
  const c={id:++V.seq,comp:sp.id,name:sp.name,to:(o.to||[]).filter(Boolean).map(b=>b.id),trigger:o.trigger||'camp',...(o.topic?{topic:o.topic}:{}),
    ...(o.from?{from:o.from.id}:{}),...(o.line?{line:clean(o.line,200)}:{}),how:o.how==='say'?'say':'party',zone:o.zone||ZONES[zoneAt(sp.x,sp.y)]||'the wilds',gm:Math.round(S.gameMin)};
  const ms=budget();
  if(ms>0&&V.cur.length<COMP.OPEN_MAX){Object.assign(c,{real:Date.now(),ms,ep:goneEpoch(),seen:null});V.cur.push(c);return {said:'dm',call:c.id}}
  return {said:'scripted',text:fill(c,'gone')}}

// ---- the agent speaks to a companion ----
const nameRe=n=>new RegExp('\\b'+String(n).toLowerCase().replace(/[^a-z0-9 ]/g,'.')+'\\b');
function named(b,text){const t=String(text||'').toLowerCase(),n=String(b.name||''),first=n.split(' ')[0];
  return (n.length>=3&&nameRe(n).test(t))||(first.length>=3&&nameRe(first).test(t))}
// After an agent's say or party_say (sim/talk.js noteSaid): a companion of its company who heard it and was named, or the only
// one near, answers once.
export function heardAgent(a,text,listeners){if(!a||!a.player||a.state==='dead')return null;const C=companyOf(a);if(!C)return null;
  const e=a.chat&&a.chat[a.chat.length-1];if(e&&e.aim)return null; // a leader's aim shout is not said to anyone
  const L=(listeners||[]).filter(b=>voiced(b)&&companyOf(b)===C);if(!L.length)return null;
  let b=L.find(x=>named(x,text));
  if(!b){const near=L.filter(x=>dist(a,x)<=COMP.NEAR);
    if(near.length===1&&!S.agents.some(x=>x!==a&&x!==near[0]&&alive(x)&&!x.hidden&&dist(a,x)<=COMP.NEAR))b=near[0]}
  if(!b)return null;
  return compLine(b,{to:[a],trigger:'reply',from:a,line:text,how:e&&e.party?'party':'say'})}
setSaidHook(heardAgent);
// The talk tool toward a companion of the hero's own company: one answer through the same voice. -> null when b is not one.
export function talkCompanion(a,b,text){if(!voiced(b)||companyOf(b)!==companyOf(a))return null;
  const r=compLine(b,{to:[a],trigger:'talk',from:a,line:text||'(turns to '+b.name+')',how:'say'});
  if(r.said==='silent')return {ok:true,who:b.name,answer:'('+b.name+' only nods; they have said enough for one day.)'};
  if(r.said==='dm')return {ok:true,who:b.name,waiting:true,note:b.name+' is thinking it over: their answer comes as a line you hear (chat_read, or the next events).'};
  return {ok:true,who:b.name,answer:r.text}}

// ---- the DM's side ----
function card(sp){const C=companyOf(sp),P=sp.persona,h=sp.hire,home=homeOf(sp);
  const c={id:sp.id,name:sp.name,cls:sp.cls,level:sp.lvl,...(sp.race?{race:sp.race}:{}),home:home?home.name:null,...(sp.originShort?{origin:sp.originShort}:{}),
    traits:(sp.traits||[]).map(t=>String(t).toLowerCase()),...(swornOf(sp)&&sp.goal.text?{oath:sp.goal.text}:{}),
    rides:h&&!h.over?'hired: '+(h.line||h.kind||'a blade for coin')+' ('+Math.max(0,Math.ceil((h.until-S.gameMin)/DAY))+' paid days left)':sp.companion!=null?'a companion who answered an invite':'a member of the company',
    company:C?C.name:null};
  if(P){for(const k of ['voice','wants','fears','quirk','never_says'])if(P[k])c[k]=P[k]}
  if(sp.backstory&&sp.backstory.summary)c.backstory=sp.backstory.summary;
  return c}
function view(c){const sp=hero(c.comp);if(!sp)return null;const C=companyOf(sp),d=gameDay();
  return {call:c.id,seconds_left:Math.max(0,Math.round((callDeadline(c.real,c.ms,c.seen)-Date.now())/100)/10),trigger:c.trigger,...(c.topic?{topic:c.topic}:{}),
    companion:card(sp),where:c.zone,time:clockStr(),
    listeners:c.to.map(hero).filter(alive).map(b=>({name:b.name,cls:b.cls,level:b.lvl,...(b.player?{you_said_to_them:(sp.cvoice&&sp.cvoice[b.id]?sp.cvoice[b.id].said:[]).slice(-8).map(x=>'D'+x.d+' '+x.text)}:{})})),
    ...(c.line?{their_words:{from:(hero(c.from)||{name:'?'}).name,text:c.line,how:c.how==='say'?'said aloud':'shouted to the company'}}:{}),
    today:C&&C.log?C.log.filter(e=>Math.floor((e.gameMin||0)/DAY)===d).slice(0,8).map(e=>e.t+' '+clean(txt(e.parts),140)):[],
    heard:heardLines(sp,8)}}
// companion_call: the oldest call waiting for the DM's voice.
export function compCall(args){compHeard(args);const V=S.compVoice,c=V&&V.cur[0];
  if(!c)return {ok:true,call:null};
  if(c.seen==null)c.seen=Date.now(); // the budget starts at pickup (#680)
  const v=view(c);if(!v){V.cur.shift();return {ok:true,call:null}}
  return {ok:true,call:v,how:'Speak as the companion: companion_say {call, text}, one or two sentences in their own voice (true to their card, today and what was said), never words for the heroes. Never repeat what you_said_to_them already holds. Silence is filled from their usual talk.'}}
// companion_say {call, text}: the DM's line for the companion.
export function compSay(args){const V=state(),id=Math.round(Number(args&&args.call)),c=V.cur.find(x=>x.id===id);
  const no=e=>{V.stats.refused++;return {ok:false,error:e}};
  if(!c)return no('No companion call '+(args&&args.call!=null?clean(args.call,12):'')+' is waiting (companion_call shows the one that is; a late answer was already filled).');
  const sp=hero(c.comp);if(!voiced(sp)){V.cur.splice(V.cur.indexOf(c),1);return no('That companion is gone or no longer rides with the company.')}
  let t=clean(args&&args.text,COMP.LINE_MAX+200);if(!t)return no('Say what? companion_say takes call and text (the companion\'s line).');
  if(t.length>COMP.LINE_MAX)return no('Too long: a companion speaks briefly ('+COMP.LINE_MAX+' characters at most).');
  if(notEnglish(t))return no('Not said: the companion speaks English, like everyone in Eldmoor.');
  const heroes=S.agents.filter(a=>a.kind==='hero'&&a.player&&a.state!=='dead'),allow={};for(const a of heroes)allow[a.name]=(a.talkSaid||[]).slice();
  const g=spokeFor(t,{names:heroes.map(a=>a.name),allow});
  if(g.cut.length){V.stats.cut++;t=g.text;if(!clean(t,COMP.LINE_MAX))return no(spokeNote(g.cut)+' Nothing else was left in it: answer again as the companion, in their own words.')}
  for(const b of c.to.map(hero))if(alive(b)&&b.player&&sp.cvoice&&sp.cvoice[b.id]&&sp.cvoice[b.id].said.some(x=>sameness(x.text,t)>=COMP.SAME))
    return no(sp.name+' already said that to '+b.name+': say something new.');
  V.cur.splice(V.cur.indexOf(c),1);deliver(c,t,'dm-agent',g.cut.length?{cut:g.cut.join(', ')}:{});
  return {ok:true,call:c.id,said:t,...(g.cut.length?{spoke_for:g.cut,warning:spokeNote(g.cut)}:{})}}
// For dm_status: the day's companion lines and the calls waiting.
export function compSummary(){const V=S.compVoice;if(!V)return null;const d=today();
  return {today:d.total+'/'+COMP.DM_PER_DAY,per_companion:COMP.PER_DAY,waiting:V.cur.map(c=>({call:c.id,companion:c.name,trigger:c.trigger})),note:'Scripted companions riding with an agent company speak through you: companion_call, then companion_say.'}}

// ---- once a step (sim/index.js): late calls are filled by the reflex ----
export function compTick(){const V=S.compVoice;if(!V||!V.cur.length)return;
  for(const c of V.cur.slice()){const sp=hero(c.comp);
    if(!voiced(sp)){V.cur.splice(V.cur.indexOf(c),1);continue} // fallen, or no longer riding with an agent: nothing to say
    const live=!(goneEpoch()>(c.ep|0))&&Date.now()<callDeadline(c.real,c.ms,c.seen)&&S.gameMin-c.gm<COMP.WAIT_GM;
    if(live)continue;V.cur.splice(V.cur.indexOf(c),1);fill(c,goneEpoch()>(c.ep|0)?'gone':'slow')}}
