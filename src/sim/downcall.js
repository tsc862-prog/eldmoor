// The DM's voice on a downing (issue #655, death slice 2b of epic #626). Owned by ai-designer. DOM-free, no RNG.
// When an agent-played hero goes down, makes a death save, or the bleeding ends (stable, up again, dead), the game puts a
// short call to the DM agent through the table_call path (call kind 'downed'): describe what can be seen and heard, true
// to the dice given. The DM never rolls, never changes HP and never decides who lives: the dice of sim/downed.js did that
// before the call is made. The call waits a bounded time (TABLE.dmMs, counted from pickup as #680, never past
// DCALL.WAIT_GM game minutes) while the DM listens; then the DM's reflex (#561) fills it with a scripted line, logged as a
// fill. Nothing ever waits: the world and any scene go on meanwhile. The line goes to the scene the hero sits in, else to
// the agent heroes who see the downing (sim/downed.js hearers).
// Bounded: one call not yet picked up per hero (news replaces it; a line the voice is already writing is left to finish), DCALL.PER_DOWN calls a downing (the downing and the end are always voiced, the
// saves only while room is left), DCALL.PER_DAY a game day. Only with a host that reports runner links (hasLinks) and an
// open DM seat, so npm run sim and the seeded checks never make one and their hashes stay put.
import {S,clockStr,dayNo} from './state.js';
import {CLS} from '../data/classes.js';
import {dmlog} from './dmlog.js';
import {CAP as CHAT_CAP} from './chat.js';
import {hasLinks} from './runlink.js';
import {heard,heardWithin,dmAlive,goneEpoch,callDeadline,lateWhy} from './dmreflex.js';
import {sceneOf} from './scenes.js';
import {onDownNews,hearersOf} from './downed.js';
import {TABLE} from './table.js';

export const DCALL={
  ON:true,
  PER_DOWN:4,     // calls a downing: the downing, the end, and saves while room is left
  PER_DAY:30,     // calls a game day, all heroes
  WAIT_GM:60,     // game minutes a call may wait at most (the world runs on meanwhile): at 1x this is TABLE.dmMs + PICKUP_MS, the real-time budget, so it never cuts a voice short at 1x
  POLL_MS:5000,   // real ms: the DM counts as listening if it polled table_call this recently (or a runner holds the seat)
  LINE_MAX:600,   // the DM's line, as a Table line (TABLE.LINE_MAX)
  ID_BASE:1000,   // call ids start here, apart from a scene's own call ids (1, 2, ...)
  PAST:20,        // answered calls kept for the views
};
const NARRATOR={kind:'dm',name:'The Narrator'};
const clean=(s,n)=>String(s==null?'':s).replace(/[\u0000-\u001f\u007f<>{}]+/g,' ').replace(/\s+/g,' ').trim().slice(0,n);
const byId=id=>S.agents.find(x=>x.id===id)||null;
const first=a=>String(a&&a.name||'').split(' ')[0];

export function downCallState(){return S.downCalls||(S.downCalls={seq:0,cur:[],past:[],per:{},day:{d:-1,n:0},stats:{asked:0,dm:0,scripted:0,skipped:0}})}
let epoch=0;
const seatOpen=()=>!!(S.dmAgent&&S.dmAgent.seat);
const listening=()=>seatOpen()&&(heardWithin('table',DCALL.POLL_MS)||dmAlive());

// ---- what each call asks, and the scripted line that fills it ----
function aboutOf(a,kind,info){const w=a.name+' (L'+a.lvl+' '+(CLS[a.cls]?CLS[a.cls].name||a.cls:a.cls)+')',d=info||{};
  const dice=d.die!=null?' The dice: d20 '+d.die+'; '+d.s+' of 3 saves made, '+d.f+' of '+d.of+' failures.':'';
  const what=kind==='down'?'has just gone down'+(d.by?' to '+d.by:'')+', bleeding at zero health'
    :kind==='save'?'lies bleeding and makes a death save: '+d.out
    :d.out==='stable'?'has stopped bleeding: stable, still down'
    :d.out==='revived'?'is brought back up by a companion\'s help'
    :d.out==='up'?'gets back up on their own'
    :d.out==='finished'?'is finished where they lay by an enemy'
    :'has died of their wounds';
  return 'Voice the moment for those who see it: '+w+' '+what+'.'+dice+' Describe only what can be seen and heard, true to the dice; never decide whether they live, what anyone does, or a number.'}
function scripted(a,kind,info){const n=a.name,d=info||{};
  if(kind==='down')return n+' goes down'+(d.by?' under '+d.by:'')+' and lies bleeding in the dirt.';
  if(kind==='save')return d.out==='success'?first(a)+' draws a ragged breath; the bleeding slows.'
    :d.out==='two failures'?first(a)+' goes grey and still; life ebbs fast.':first(a)+'\'s breath rattles; the bleeding does not stop.';
  return d.out==='stable'?'The bleeding stops. '+first(a)+' still lies there, but breathes.'
    :d.out==='revived'?n+' is hauled back from the brink, gasping.'
    :d.out==='up'?n+' staggers to their feet again.'
    :d.out==='finished'?n+' is finished where they lay.'
    :n+' breathes no more.'}
const END={stable:'stable',revived:'revived',up:'up',died:'died',finished:'finished'};

// ---- the hook: sim/downed.js reports each downing, save and end ----
function news(a,kind,info){if(!DCALL.ON||!a||!a.player||!hasLinks()||!seatOpen())return;
  const D=downCallState(),k=kind==='down'||kind==='save'?kind:END[kind]?'end':null;if(!k)return;
  const per=D.per[a.id];
  if(k==='down')D.per[a.id]={n:0};
  else if(!per)return; // a downing we never voiced (before the seat opened): its saves and end stay unvoiced
  const P=D.per[a.id],pend=D.cur.find(c=>c.hero===a.id&&c.state==='wait');
  if(k==='save'&&(pend||P.n>=DCALL.PER_DOWN-1)){D.stats.skipped++;return}
  for(const c of D.cur.slice())if(c.hero===a.id&&c.state==='wait'&&c.seen==null)fill(c,'slow'); // overtaken before the voice read it; once read, it is being written: let it land
  const day=dayNo();if(D.day.d!==day)D.day={d:day,n:0};
  if(D.day.n>=DCALL.PER_DAY){D.stats.skipped++;if(k==='end')delete D.per[a.id];return}
  D.day.n++;P.n++;if(k==='end')delete D.per[a.id];
  const i={...(info||{}),...(k==='end'?{out:kind}:{})};
  if(k==='down'&&a.down&&a.down.by)i.by=a.down.by.kind==='boss'?'Kragmaw':a.down.by.name||null;
  const sc=sceneOf(a);
  const c={id:DCALL.ID_BASE+(++D.seq),hero:a.id,name:a.name,kind:k,about:aboutOf(a,k,i),line:scripted(a,k,i),scene:sc?sc.id:null,
    hear:sc?null:hearersOf(a).map(b=>b.id),gm:Math.round(S.gameMin),t:clockStr(),state:'wait',real:0,ms:0,seen:null};
  D.cur.push(c);D.stats.asked++;
  if(listening()){c.real=Date.now();c.ms=TABLE.dmMs;epoch=goneEpoch();return}
  fill(c,'gone')}
onDownNews(news);

// The line reaches the hero's scene (every member there, and the banner), else those who saw it in the world.
function deliver(c,text){const a=byId(c.hero),sc=c.scene!=null&&a?sceneOf(a):null;
  const e={t:clockStr(),d:dayNo(),from:NARRATOR,text,trigger:'dm',dm:true,...(sc?{scene:true}:{})};
  const ids=sc&&sc.id===c.scene?sc.ids:(c.hear||[]).concat(a&&!(c.hear||[]).includes(a.id)?[a.id]:[]);
  for(const id of ids){const b=byId(id);if(!b||b.state==='dead'&&b.id!==c.hero)continue;(b.chat||(b.chat=[])).push(e);if(b.chat.length>CHAT_CAP)b.chat.shift()}
  if(sc&&sc.id===c.scene)sc.narr={t:e.t,text}}
function close(c,text,by,why){const D=downCallState();c.state='done';c.by=by;c.text=text;if(why)c.why=why;
  D.cur.splice(D.cur.indexOf(c),1);D.past.push(c);if(D.past.length>DCALL.PAST)D.past.shift();
  if(by==='dm-agent')D.stats.dm++;else D.stats.scripted++;
  deliver(c,text);
  dmlog('agent',null,['At a downing ('+c.name+', '+c.kind+'): ',text,by==='scripted'?' [scripted fill'+(c.real?': '+lateWhy(c.seen):'')+']':''],
    {by,call:'downed',kind:c.kind,hero:c.hero,text,...(by==='scripted'?{fill:true,why:why||'gone',...(c.real?{late:lateWhy(c.seen)}:{})}:{})},{heroes:[c.hero]})}
function fill(c,why){if(c.state!=='wait')return;close(c,c.line,'scripted',why)}

// Once per step (sim/index.js): waits that ran out are filled. No-op without S.downCalls.
export function downCallTick(){const D=S.downCalls;if(!D||!D.cur.length)return;
  const gone=epoch!==goneEpoch()||!seatOpen();if(gone)epoch=goneEpoch();
  for(const c of D.cur.slice())if(c.state==='wait'&&(gone||!c.real||Date.now()>=callDeadline(c.real,c.ms,c.seen)||S.gameMin-c.gm>=DCALL.WAIT_GM))fill(c,gone||!c.real?'gone':'slow')}

// ---- the DM's side: table_call and table_answer ask here first (sim/dmagent.js) ----
// table_call: the oldest waiting downed call, or null (then the scene calls answer as before).
export function downCall(){const D=S.downCalls;if(!D||!D.cur.length)return null;heard('table');
  const c=D.cur.find(x=>x.state==='wait');if(!c)return null;const a=byId(c.hero);
  if(c.real&&c.seen==null)c.seen=Date.now(); // the budget starts at pickup (#680)
  const left=c.real?Math.max(0,(callDeadline(c.real,c.ms,c.seen)-Date.now())/1000):0,sc=a?sceneOf(a):null;
  return {ok:true,staged:null,downed:{hero:c.name,waiting:D.cur.length},
    scene:{title:c.name+' is down',kind:'downed',frame:sc?sc.title:'In the open, '+c.t,order:[],so_far:[],said:D.past.filter(x=>x.hero===c.hero).slice(-3).map(x=>x.text),cast:[]},
    call:{id:c.id,kind:'downed',about:c.about,who:c.name,seconds_left:Math.round(left*10)/10,max_chars:DCALL.LINE_MAX}}}
// table_answer {call, text}: null when the id is not a downed call (a scene's call then).
export function downAnswer(args){const id=Math.round(Number(args&&args.call));if(!(id>DCALL.ID_BASE))return null;const D=S.downCalls;if(!D)return null;
  const c=D.cur.find(x=>x.id===id)||D.past.find(x=>x.id===id);if(!c)return null;heard('table');
  if(c.state!=='wait')return {ok:false,error:'too late: the '+(c.by==='scripted'?'scripted DM':'DM')+' already voiced call '+id};
  const text=clean(args.text,DCALL.LINE_MAX);if(!text)return {ok:false,error:'say something: what those near '+c.name+' see and hear'};
  close(c,text,'dm-agent');return {ok:true,call:id,kind:'downed',said:text,next:D.cur.some(x=>x.state==='wait')?'another call is waiting (table_call)':null}}
// dm_status: what waits.
export function downCallSummary(){const D=S.downCalls;if(!D)return null;const w=D.cur.filter(c=>c.state==='wait');
  return w.length?{waiting:w.length,heroes:[...new Set(w.map(c=>c.name))],note:'A hero is down: voice it with table_call and table_answer (a few seconds; then the scripted DM fills it). Words only: the dice already decided.'}:null}
// For checks and views.
export const downCallsOf=heroId=>(S.downCalls?S.downCalls.past.concat(S.downCalls.cur):[]).filter(c=>heroId==null||c.hero===heroId);
