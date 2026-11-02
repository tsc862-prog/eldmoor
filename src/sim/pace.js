// Runner pacing (issue #126): when an agent-played hero's runner should start its next turn.
// Not a tool: the model never calls it. A runner asks between turns (POST /play/pace on the relay,
// answered by the host through sim/player-host.js hostPace) and starts a turn when
//   'now'        something cannot wait: attacked, badly hurt, a choice, a table scene, a camp alarm
//                (events with e.w=2, sim/notify.js), or the hero sits at an open Table scene;
//   'soft'       something happened that the agent has not read yet (an urgent event such as an
//                arrival or a vote, a party line, the narrator, a person speaking to the hero);
//   'heartbeat'  `minutes` of game time passed since `since` with nothing of the sort.
// With wake:'now' only the first kind counts (the runner's minimum real-time gap has not passed yet); with
// wake:'must' only a choice or a table scene (e.w=3), which must be answered in time (answers carry must:true).
// paceBrief: the state header a runner puts on every local turn prompt (the coordinator's live bug: a
// small model kept narrating a fight long over), from what the hero itself knows.
// It reads the events the agent has not seen (e.n > a.playEvSeen) and never consumes them: the next
// tool call hands them over as usual. It writes nothing (but for a Fellowship letter it delivers to a new
// member's notebook, sim/notebook.js), so a world with no runner is unchanged.
import {S,clockStr} from './state.js';
import {wakeLevel} from './notify.js';
import {tableView} from './table.js';
import {maxHp} from './heroes.js';
import {ZONES,zoneAt} from '../world/map.js';
import {MOBS} from '../data/mobs.js';
import {notTold,NOT_TOLD} from './reach.js';
import {heroRelevant} from './notebook.js'; // the notes that matter now (#155)
import {asleep,campView} from './camp.js';

export const PACE={REAL_MS:10000,REAL_MAX:30000,MIN:[5,24*60]}; // a pace call holds at most REAL_MS (asked up to REAL_MAX); heartbeat bounds in game minutes

const hero=id=>S.agents.find(x=>x.id===id)||null;
const day=()=>'Day '+(Math.floor(S.gameMin/1440)+1)+' '+clockStr();

// One look: a wake answer, or null to keep waiting. Errors (dead, gone) end the runner.
export function paceCheck(id,{since=null,minutes=240,wake='all'}={}){const a=hero(Number(id));
  if(!a||a.kind!=='hero')return {ok:false,gone:true,error:'No such hero.'};
  if(a.state==='dead')return {ok:false,dead:true,error:a.name+' is dead ('+(a.cause||'fallen')+'). Hardcore: one life.'};
  if(!a.player)return {ok:false,gone:true,error:a.name+' is no longer agent-played.'};
  const from=Number.isFinite(Number(since))&&since!==null?Number(since):S.gameMin,m=Math.min(PACE.MIN[1],Math.max(PACE.MIN[0],Number(minutes)||240));
  const out=(w,why,must)=>({ok:true,wake:w,why:why||null,...(must?{must:true}:{}),gameMin:Math.round(S.gameMin),since:from,clock:day(),table:!!tv});
  const tv=tableView(a);
  if(tv&&!tv.acted&&tv.phase!=='outcome')return out('now','a scene at the table: '+tv.scene,true);
  const seen=a.playEvSeen||0,sleeping=asleep(a);let soft=null,now=null; // a sleeper's agent gets no soft turns and no heartbeat: only wake events (#178)
  for(const e of a.playEv||[]){if(e.n<=seen)continue;const l=wakeLevel(e);if(l>=3)return out('now',e.text,true);if(l===2&&!now)now=e;if(l===1&&!soft&&!sleeping)soft=e}
  if(wake==='must')return null;
  if(now)return out('now',now.text);
  if(wake==='now')return null;
  if(soft)return out('soft',soft.text);
  if(!sleeping&&S.gameMin>=from+m)return out('heartbeat',m+' game minutes passed');
  return null}

// The answer when the real-time cap ran out with nothing to wake for: the runner asks again.
export function paceIdle(id,since){const a=hero(Number(id));return {ok:true,wake:null,gameMin:Math.round(S.gameMin),since:since!=null?Number(since):Math.round(S.gameMin),clock:day(),table:!!(a&&tableView(a))}}

// The hero's state right now, for the top of a turn prompt: what it is doing, HP, where, its foe, and the
// news it has not read yet (not consumed: the next tool call still hands them over).
export function paceBrief(id){const a=hero(Number(id));
  if(!a||a.kind!=='hero')return {ok:false,gone:true,error:'No such hero.'};
  if(a.state==='dead')return {ok:false,dead:true,error:a.name+' is dead ('+(a.cause||'fallen')+'). Hardcore: one life.'};
  if(!a.player)return {ok:false,gone:true,error:a.name+' is no longer agent-played.'};
  const t=a.target,fighting=(a.state==='fight'||a.state==='duel'||a.state==='assist')&&t&&(t.hp>0||t.alive);
  const foe=fighting?(t.kind==='hero'?t.name:t.elite||t.named?t.name:(MOBS[t.type]&&MOBS[t.type].name||'a monster')+(t.lvl?' (level '+t.lvl+')':'')):null;
  const seen=a.playEvSeen||0,news=(a.playEv||[]).filter(e=>e.n>seen).slice(-8).map(e=>e.t+' '+e.text),tv=tableView(a);
  return {ok:true,brief:{clock:day(),state:a.state,doing:a.playDoing||null,hp:Math.max(0,Math.round(a.hp/maxHp(a)*100))+'%',level:a.lvl,place:ZONES[zoneAt(a.x,a.y)]||null,
    foe,autopilot:!!a.playIdle,camp:campView(a),table:!!(tv&&tv.phase!=='outcome'),news,memories:heroRelevant(a),...(notTold(a)?{warning:NOT_TOLD}:{})}}} // memories: the hero's own notes most relevant now, {id, title} only (#155)
