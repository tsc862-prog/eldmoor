// Agent player (issue #75): one tool call, start to finish, for whichever process hosts the
// world (the browser page through src/ui/player-bridge.js, or scripts/play-headless.mjs).
// DOM-free and outside the step loop: it only reads and writes through sim/player.js and
// uses timers, so the world keeps stepping while a `wait` is pending.
import {playerAct,waitOver,finishWait,turnStart,turnEnd,lookSnap} from './player.js';
import {paceCheck,paceIdle,paceBrief,PACE} from './pace.js';
import {worldHeld} from './prep.js';
import {reflectDone} from './reflect.js';
import {markQueued,sceneDue,tableRest,restText,AWAY_TEXT} from './scenewait.js';
import {S} from './state.js';
import {companyOf,leaderOf,inSlots,partySlotted,slotKeyOf} from './company.js';
import {sceneOf} from './scenes.js';
import {worldAtTable} from './table.js';
import {dmAct} from './dmagent.js';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));

// Returns a promise of the tool's result. `wait` resolves when its game time has passed,
// something urgent happened, the hero died, or realMs of real time ran out (a paused world).
export async function hostCall(heroId,tool,args,{poll=100,nap=sleep,now=()=>Date.now()}={}){
  if(tool==='pace')return hostPace(heroId,args,{poll,nap,now});
  const r=playerAct(heroId,tool,args||{});
  if(!r||!r.pending)return r;
  const p=r.pending,t0=now(),me=S.agents.find(x=>x.id===Number(heroId));
  // #868: a wait that can pass no time ends the turn at once, at the start or the moment a scene stops it, so nobody holds a model
  // slot while the table waits for someone else (a hold here deadlocked the table, and #687's looped 0-minute waits are the runner's
  // to end: the result says turn_over). A member whose own scene is due gets the wait back at once with table_waits.
  for(;;){const rest=restOf(me);if(rest){me.tableRest=true;return finishWait(p,false,rest)}
    if(waitOver(p)||(me&&sceneDue(me)))return finishWait(p,false);
    if(now()-t0>=p.realMs)return finishWait(p,true);await nap(poll)}}
const restOf=a=>!a||a.state==='dead'||sceneDue(a)?null:tableRest(a)?restText(a):worldAtTable()?AWAY_TEXT:null;

// Runner pacing (issue #126, sim/pace.js): not a game tool (MCP and /play/call never offer it; the relay
// sends it from POST /play/pace). Resolves when the hero's next turn should start, or after realMs
// with wake:null so the runner asks again. Reads only; logs nothing in the Agent tab.
export async function hostPace(heroId,args,{poll=100,nap=sleep,now=()=>Date.now()}={}){
  const p=args&&typeof args==='object'?args:{},me=()=>S.agents.find(x=>x.id===Number(heroId));
  if(p.brief){const r=paceBrief(heroId,{self:!!p.self}),a=me();if(r&&r.ok&&a&&a.playFresh){a.playFresh=false;lookSnap(a)}return r} // the state header for a turn prompt, at once; the one a runner reads after its wake is the agent's view of the world (#240; the relay's after-turn brief for the behavior log is not)
  if(p.held){const a=me();if(!a||a.kind!=='hero')return {ok:false,gone:true,error:'No such hero.'};if(a.state==='dead')return {ok:false,dead:true,error:a.name+' is dead.'};if(!a.player)return {ok:false,gone:true,error:a.name+' is no longer agent-played.'};return {ok:true,held:worldHeld()||null}} // the first turn of a run asks whether the start gate or the DM's prep still holds the world (#770)
  if(p.queued!=null){const a=me();return a?markQueued(a,!!p.queued,p.why):{ok:false,gone:true,error:'No such hero.'}} // the runner: this member's scene answer is queued behind other work (#515)
  if(p.reflected!=null){const a=S.agents.find(x=>x.id===Number(heroId));return a&&a.player?reflectDone(a,String(p.reflected),p.wrote):{ok:false,error:'not agent-played'}} // a reflection closed (#179)
  const t0=now(),rm=Number(p.realMs),realMs=Math.min(PACE.REAL_MAX,Number.isFinite(rm)&&rm>=0&&p.realMs!==null?rm:PACE.REAL_MS);
  const q={since:Number.isFinite(Number(p.since))&&p.since!==null?Number(p.since):paceIdle(heroId,null).since,minutes:p.minutes,wake:p.wake==='now'||p.wake==='must'?p.wake:'all',reflect:!!p.reflect};
  turnEnd(me()); // a runner asking when to go next has ended its turn: autopilot may start things again (#240)
  {const a=me(),n=Number(p.hearWake);if(a){if(n>0)a.playHearGap=Math.min(1440,n);else if(a.playHearGap!=null)delete a.playHearGap}} // the runner's AGENT_HEAR_WAKE_MIN (#787); unset: the game's PK.HEAR_WAKE
  for(;;){const r=paceCheck(heroId,q);if(r){const a=me();if(r.ok&&r.wake&&a){turnStart(a);a.playFresh=true;delete a.tableRest}return r} // a wake opens the next turn
    if(now()-t0>=realMs)return paceIdle(heroId,q.since);await nap(poll)}}

// The DM's voice calls, long-polled (#680): table_call, npc_call and ruling_call with {wait_ms} (up to DM_WAIT.MAX) are held
// here until a call is pending or the wait runs out, re-checked every `poll` ms, so the runner is told within a poll and asks
// once instead of every second (the relay counts one call). Each check is the ordinary tool, so it stamps the DM as listening.
// Any other tool, or no wait_ms, is answered at once (dmAct). A refusal (the seat closed) comes back at once.
export const DM_WAIT={MAX:25000,POLL:150};
const DM_POLLS={table_call:1,npc_call:1,ruling_call:1,companion_call:1};
export const dmWaitMs=(tool,args)=>DM_POLLS[tool]&&args&&typeof args==='object'?Math.min(DM_WAIT.MAX,Math.max(0,Number(args.wait_ms)||0)):0;
export async function hostDm(tool,args,{poll=DM_WAIT.POLL,nap=sleep,now=()=>Date.now()}={}){
  const a=args&&typeof args==='object'?args:{},w=dmWaitMs(tool,a);if(!w)return dmAct(tool,a);
  const t0=now();for(;;){const r=dmAct(tool,a);if(!r||r.ok===false||r.call||now()-t0>=w)return r;await nap(poll)}}

// One agent seat as the host names it to the relay (the page's hello, play-headless's info; /play/health heroes[]).
// fellow/role/lead: the five-place Fellowship (#68), kept as they were. company (#460): every agent hero rides in one
// (a solo is a company of one): its id, name and size, and for a company of two or more who leads it, whether the hero
// sits at a scene (table) and whether its own scene still waits for its answer (due, #515). Game state only (#123).
export function seatInfo(a){const o={id:a.id,name:a.name,alive:a.state!=='dead',...(a.succeeds!=null?{succeeds:a.succeeds}:{})};
  if(inSlots(a))Object.assign(o,{fellow:true,role:slotKeyOf(a)||null,lead:!!(a.party&&partySlotted(a.party)&&a.party.leader===a),table:!!sceneOf(a),...(sceneDue(a)?{due:true}:{})});
  if(S.gambitHold&&S.gambitHold.id===a.id)o.hold=true; // a gambit hold waits for this hero's next act (#630): its turn starts at once
  const C=companyOf(a);if(C){o.company=C.id;o.companyName=C.name||null;o.size=C.ids.length;
    if(!inSlots(a)&&C.ids.length>1){o.lead=leaderOf(C)===a;o.table=!!sceneOf(a);if(sceneDue(a))o.due=true}}
  return o}
