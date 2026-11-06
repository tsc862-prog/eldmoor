// The narrator's voice between scenes (#1017). Owned by brain-builder. DOM-free, no RNG, no gameplay state touched.
// Live play: 30 game hours with a DM runner up and two DM lines heard. A DM turn is a reading and planning turn of tens of
// thousands of tokens; a line as the company walks into a town does not need one. Like the table, talk and companion voices, this
// is one small structured model call per line, in the runner, at about a tenth of the price of the cheapest turn:
//   moments  a company reaches a town, a region or a named place; day breaks on it; a member says a line aloud
//   narrator_call {budget_s, wait_ms}  the oldest moment waiting (long-polled like the other voices): who, where, the hour, what was
//            just said, what the narrator already said, the DM's own plans and threads by title
//   narrator_say {call, text}  the line, through the narrate tool itself: its daily cap, the #750 cut of a member's words and the
//            DM log all apply. An empty text is silence (a line among the company needs no answer from the world).
// It never holds the world and has no scripted fill: a late moment is dropped, and the world is as it was. It only looks while the
// voice polls (POLL_MS), so a world with no runner (npm run sim, the seeded checks) never gets here and nothing moves. Lines are
// heard, not woken for: e.quiet keeps a member's runner from taking a turn for one (a turn costs far more than the line).
// Limits: NAR.PER_DAY of the day's narrate lines at most (the rest stay for the DM's own turns and whens), shared out between the
// companies, NAR.GAP game minutes between two lines to one company. These are channels the heroes already have: the line reaches
// those within narrate's radius of the leader, and the call carries nothing a DM may not read.
//
// state: S.narrVoice {seq, cur:[moment], co:{[company id]:{z, town, at, dawn, last, spoke, n}}, day:{d, n}, said:[{t, text}], stats}
//   moment {id, kind: town|region|place|dawn|spoke, cid, what, from?, line?, real, ms, seen, gm}
import {S,clockStr} from './state.js';
import {ZONES,LANDMARKS,CITY,zoneAt,dist} from '../world/map.js';
import {focuses} from './dmfocus.js';
import {findScene} from './scenes.js';
import {worldHeld} from './prep.js';
import {heardLines,addSaidHook} from './talk.js';
import {callDeadline,goneEpoch} from './dmreflex.js';
import {maxHp} from './heroes.js';

export const NAR={
  ON:true,
  EVERY:2,          // game minutes between two looks at the companies
  PER_DAY:8,        // lines a game day from this voice, of the DM's narrate lines (DMA.NARRATE_PER_DAY 12)
  GAP:60,           // game minutes between two lines to one company
  SPOKE_GAP:180,    // ... and between two moments for a line a member said aloud
  PLACE_R:5,        // tiles: a company at a named place
  DAWN_HH:6,DAWN_END:10, // the clock hours a new day's line may come in
  MS:8000,MIN_MS:4000,MAX_MS:30000, // real ms a moment waits for its line, from pickup; the range narrator_call {budget_s} may ask for
  PICKUP_MS:20000,  // real ms a moment waits for the voice to pick it up (a voice mid-call polls again when that call is done)
  POLL_MS:30000,    // real ms: a narrator_call this recent counts as the voice listening
  OPEN_MAX:3,       // moments waiting at once
  SAID_KEEP:6,      // the narrator's own last lines the voice is shown
  RADIUS:12,        // narrate's radius round the leader
};
const DAY=1440;
const gameDay=()=>Math.floor(S.gameMin/DAY);
const hourNow=()=>Math.floor((S.gameMin%DAY)/60);
const part=h=>h<6?'night':h<12?'morning':h<18?'afternoon':'evening';
const clip=(s,n)=>{s=String(s==null?'':s).replace(/\s+/g,' ').trim();return s.length>n?s.slice(0,n-1)+'…':s};
const hpWord=a=>{const f=a.hp/maxHp(a);return f<.35?'badly hurt':f<.7?'hurt':'well'};

let pollAt=0,askMs=0,epoch=-1;
function heardPoll(args){pollAt=Date.now();epoch=goneEpoch();const b=Number(args&&args.budget_s);askMs=Number.isFinite(b)&&b>0?Math.max(NAR.MIN_MS,Math.min(NAR.MAX_MS,b*1000)):0}
const listening=()=>pollAt>0&&Date.now()-pollAt<NAR.POLL_MS&&epoch===goneEpoch();
function state(){return S.narrVoice||(S.narrVoice={seq:0,cur:[],co:{},day:{d:-1,n:0,by:{}},said:[],at:-1e9,stats:{asked:0,spoke:0,silent:0,late:0,refused:0}})}
function today(){const N=state();if(N.day.d!==gameDay())N.day={d:gameDay(),n:0,by:{}};return N.day}
// A company's share of the day's lines: everyone gets some, however many ride.
const shareOf=n=>Math.max(1,Math.ceil(NAR.PER_DAY/Math.max(1,n)));
const atTable=fo=>!!findScene(sc=>(sc.ids||[]).some(id=>fo.ids.has(id)));
const agentsIn=fo=>fo.members.some(a=>a.player);
const leadOf=fo=>{const L=fo.members.filter(b=>!b.hidden),p=fo.party&&fo.party.leader;return L.includes(p)?p:L[0]||null};
function placeAt(a){let best=null,bd=NAR.PLACE_R+1;for(const p of [...(S.places||[]),...LANDMARKS]){if(!p||!p.name||!Number.isFinite(p.x))continue;const d=dist(a,p);if(d<bd){bd=d;best=p}}return best&&best.name}

function post(fo,co,kind,what,more={}){const N=state(),d=today();const left=d.n<NAR.PER_DAY&&(d.by[fo.cid]||0)<shareOf(focuses().length);
  if(!left||N.cur.length>=NAR.OPEN_MAX||N.cur.some(m=>m.cid===fo.cid)||S.gameMin-co.last<NAR.GAP)return false;
  N.cur.push({id:++N.seq,kind,cid:fo.cid,what,real:Date.now(),ms:askMs||NAR.MS,gm:Math.round(S.gameMin),...more});N.stats.asked++;return true}
// Once a step (sim/index.js). Nobody listening: returns at once and writes nothing.
export function narrTick(){if(!NAR.ON||!listening())return;const N=state(),now=Date.now();
  for(const m of N.cur.slice())if(now>=(m.seen!=null?callDeadline(m.real,m.ms,m.seen,NAR.PICKUP_MS):m.real+NAR.PICKUP_MS)){N.cur.splice(N.cur.indexOf(m),1);N.stats.late++}
  if(S.gameMin-N.at<NAR.EVERY)return;N.at=S.gameMin;const held=!!worldHeld(),h=hourNow(),d=gameDay();
  for(const fo of focuses()){if(!agentsIn(fo))continue;const a=leadOf(fo);if(!a)continue;const town=a.state==='town'?a.town||null:null,z=zoneAt(a.x,a.y),at=town?null:placeAt(a),co=N.co[fo.cid];
    if(!co){N.co[fo.cid]={z,town,at,dawn:d,last:-1e9,spoke:-1e9};continue} // from here on: what is true when the voice starts is no arrival
    const was={z:co.z,town:co.town,at:co.at};co.z=z;co.town=town;co.at=at;
    if(held||atTable(fo)||a.state==='dungeon')continue; // the table has its own voice; a moment that passes in a scene is gone
    if(town&&town!==was.town)post(fo,co,'town','They walk into '+town+'.',{place:town});
    else if(at&&at!==was.at)post(fo,co,'place','They reach '+at+'.',{place:at});
    else if(!town&&z!==was.z&&z>=0)post(fo,co,'region','They cross into '+ZONES[z]+'.',{place:ZONES[z]});
    else if(co.dawn!==d&&h>=NAR.DAWN_HH&&h<NAR.DAWN_END){co.dawn=d;post(fo,co,'dawn','A new day breaks on them.')}}}
// A member said a line aloud out in the world: a moment, if the world may answer. Not a shout (it is meant for the company), not at
// the table, not in town (the people there answer through the talk voice).
function spoken(a,text){const e=a&&a.chat&&a.chat[a.chat.length-1];if(!NAR.ON||!listening()||!a||!a.player||a.state==='town'||e&&(e.party||e.aim))return;const fo=focuses().find(f=>f.ids.has(a.id));if(!fo||atTable(fo)||worldHeld())return;
  const N=state(),co=N.co[fo.cid];if(!co||S.gameMin-(co.spoke??-1e9)<NAR.SPOKE_GAP)return;
  if(post(fo,co,'spoke',a.name+' says this aloud.',{from:a.name,line:clip(text,200)}))co.spoke=S.gameMin}
addSaidHook(spoken);

function view(m){const fo=focuses().find(f=>f.cid===m.cid),a=fo&&leadOf(fo);if(!a)return null;const N=state(),h=hourNow();
  return {call:m.id,kind:m.kind,seconds_left:Math.max(0,Math.round((callDeadline(m.real,m.ms,m.seen,NAR.PICKUP_MS)-Date.now())/100)/10),what:m.what,time:clockStr(),part:part(h),
    company:fo.company.name||null,members:fo.members.map(b=>b.name+' ('+b.cls+', '+hpWord(b)+')'),near:a.name,
    where:{region:ZONES[zoneAt(a.x,a.y)]||null,town:a.state==='town'?a.town||null:null,place:m.place||placeAt(a)||null},
    ...(m.line?{their_words:{from:m.from,text:m.line}}:{}),heard:heardLines(a,5),you_said:N.said.slice(-NAR.SAID_KEEP).map(x=>x.text)}}
// narrator_call: the oldest moment waiting. notes: the DM's plans and threads that bear on it, by title (dmagent.js hands them over).
export function narrCall(args,notes=[]){heardPoll(args);const N=S.narrVoice,m=N&&N.cur[0];if(!m)return {ok:true,call:null};
  if(m.seen==null)m.seen=Date.now(); // the budget starts at pickup (#680)
  const v=view(m);if(!v||!v.near){N.cur.shift();return {ok:true,call:null}}
  return {ok:true,call:{...v,your_notes:notes}}}
// narrator_say {call, text}: say is the narrate tool, as dmagent.js runs it. An empty text is the voice's silence.
export function narrSay(args,say){const N=state(),id=Math.round(Number(args&&args.call)),m=N.cur.find(x=>x.id===id);
  if(!m)return {ok:false,error:'No moment '+(args&&args.call!=null?clip(args.call,12):'')+' is waiting (a late line is dropped).'};
  N.cur.splice(N.cur.indexOf(m),1);const t=clip(args&&args.text,600),fo=focuses().find(f=>f.cid===m.cid),a=fo&&leadOf(fo);if(!t||!a){N.stats.silent++;return {ok:true,call:id,silent:true}}
  const r=say({text:t,near:a.name,radius:NAR.RADIUS,_voice:m.kind});if(!r||r.ok===false){N.stats.refused++;return r||{ok:false,error:'not said'}}
  const said=r.narrated||t,co=N.co[fo.cid],d=today();if(co)co.last=S.gameMin;d.n++;d.by[fo.cid]=(d.by[fo.cid]||0)+1;N.stats.spoke++;
  N.said.push({t:clockStr(),text:said});if(N.said.length>NAR.SAID_KEEP)N.said.shift();return {ok:true,call:id,said,heard_by:r.heard_by,...(r.spoke_for?{spoke_for:r.spoke_for,warning:r.warning}:{})}}
export const narrStats=()=>{const N=S.narrVoice;if(!N)return null;const d=today();return {today:d.n+'/'+NAR.PER_DAY,...N.stats}};
