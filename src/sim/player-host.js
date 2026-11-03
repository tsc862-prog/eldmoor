// Agent player (issue #75): one tool call, start to finish, for whichever process hosts the
// world (the browser page through src/ui/player-bridge.js, or scripts/play-headless.mjs).
// DOM-free and outside the step loop: it only reads and writes through sim/player.js and
// uses timers, so the world keeps stepping while a `wait` is pending.
import {playerAct,waitOver,finishWait,turnStart,turnEnd,lookSnap} from './player.js';
import {paceCheck,paceIdle,paceBrief,PACE} from './pace.js';
import {reflectDone} from './reflect.js';
import {markQueued,sceneDue} from './scenewait.js';
import {S} from './state.js';
import {companyOf,leaderOf,inSlots,partySlotted,slotKeyOf} from './company.js';
import {sceneOf} from './scenes.js';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));

// Returns a promise of the tool's result. `wait` resolves when its game time has passed,
// something urgent happened, the hero died, or realMs of real time ran out (a paused world).
export async function hostCall(heroId,tool,args,{poll=100,nap=sleep,now=()=>Date.now()}={}){
  if(tool==='pace')return hostPace(heroId,args,{poll,nap,now});
  const r=playerAct(heroId,tool,args||{});
  if(!r||!r.pending)return r;
  const p=r.pending,t0=now();
  while(!waitOver(p)){if(now()-t0>=p.realMs)return finishWait(p,true);await nap(poll)}
  return finishWait(p,false)}

// Runner pacing (issue #126, sim/pace.js): not a game tool (MCP and /play/call never offer it; the relay
// sends it from POST /play/pace). Resolves when the hero's next turn should start, or after realMs
// with wake:null so the runner asks again. Reads only; logs nothing in the Agent tab.
export async function hostPace(heroId,args,{poll=100,nap=sleep,now=()=>Date.now()}={}){
  const p=args&&typeof args==='object'?args:{},me=()=>S.agents.find(x=>x.id===Number(heroId));
  if(p.brief){const r=paceBrief(heroId,{self:!!p.self}),a=me();if(r&&r.ok&&a&&a.playFresh){a.playFresh=false;lookSnap(a)}return r} // the state header for a turn prompt, at once; the one a runner reads after its wake is the agent's view of the world (#240; the relay's after-turn brief for the behavior log is not)
  if(p.queued!=null){const a=me();return a?markQueued(a,!!p.queued):{ok:false,gone:true,error:'No such hero.'}} // the runner: this member's scene answer is queued behind other work (#515)
  if(p.reflected!=null){const a=S.agents.find(x=>x.id===Number(heroId));return a&&a.player?reflectDone(a,String(p.reflected),p.wrote):{ok:false,error:'not agent-played'}} // a reflection closed (#179)
  const t0=now(),rm=Number(p.realMs),realMs=Math.min(PACE.REAL_MAX,Number.isFinite(rm)&&rm>=0&&p.realMs!==null?rm:PACE.REAL_MS);
  const q={since:Number.isFinite(Number(p.since))&&p.since!==null?Number(p.since):paceIdle(heroId,null).since,minutes:p.minutes,wake:p.wake==='now'||p.wake==='must'?p.wake:'all',reflect:!!p.reflect};
  turnEnd(me()); // a runner asking when to go next has ended its turn: autopilot may start things again (#240)
  for(;;){const r=paceCheck(heroId,q);if(r){const a=me();if(r.ok&&r.wake&&a){turnStart(a);a.playFresh=true}return r} // a wake opens the next turn
    if(now()-t0>=realMs)return paceIdle(heroId,q.since);await nap(poll)}}

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
