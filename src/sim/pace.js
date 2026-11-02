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
import {tableView,optionsFor} from './table.js';
import {heardLines,metNames} from './talk.js';
import {maxHp} from './heroes.js';
import {ZONES,zoneAt} from '../world/map.js';
import {MOBS} from '../data/mobs.js';
import {notTold,NOT_TOLD} from './reach.js';
import {heroRelevant} from './notebook.js'; // the notes that matter now (#155)
import {reflectDue} from './reflect.js'; // reflection moments (#179)
import {asleep,campView} from './camp.js';
import {localsNear} from './locals.js';
import {earshotLine} from './earshot.js'; // who hears you now, one line (#395) // people about, with a short hook each
import {foeName} from './lore.js'; // the foe as the hero knows it, never its level (#188)
import {questBrief} from './questlog.js'; // the focused quest and how many others
import {focus,hallHooks,hallTitle} from './dmfocus.js'; // where the Fellowship rides (#165), the hall jobs that concern it (#326)
import {homeOf} from '../data/races.js';
import * as ADV from '../data/adventures.js';

export const PACE={REAL_MS:10000,REAL_MAX:30000,MIN:[5,24*60],HALL:3}; // a pace call holds at most REAL_MS (asked up to REAL_MAX); heartbeat bounds in game minutes

const hero=id=>S.agents.find(x=>x.id===id)||null;
const day=()=>'Day '+(Math.floor(S.gameMin/1440)+1)+' '+clockStr();

// One look: a wake answer, or null to keep waiting. Errors (dead, gone) end the runner.
// reflect: the runner plays reflection moments (#179): a due one starts a turn (soft, even for a sleeper: "before you rest").
export function paceCheck(id,{since=null,minutes=240,wake='all',reflect=false}={}){const a=hero(Number(id));
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
  if(reflect){const r=reflectDue(a);if(r)return out('soft','a moment to reflect: '+r.why)}
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
  const foe=fighting?foeName(a,t):null;
  const seen=a.playEvSeen||0,news=(a.playEv||[]).filter(e=>e.n>seen).slice(-8).map(e=>e.t+' '+e.text),tv=tableView(a);
  return {ok:true,brief:{clock:day(),state:a.state,doing:a.playDoing||null,hp:Math.max(0,Math.round(a.hp/maxHp(a)*100))+'%',level:a.lvl,place:ZONES[zoneAt(a.x,a.y)]||null,
    foe,autopilot:!!a.playIdle,camp:campView(a),table:!!(tv&&tv.phase!=='outcome'),news,memories:heroRelevant(a),...(notTold(a)?{warning:NOT_TOLD}:{}), // memories: the hero's own notes most relevant now, {id, title} only (#155)
    scene:sceneOpen(a,tv),heard:heardLines(a),met:metNames(a),nearby:localsNear(a).map(x=>x.hook),earshot:earshotLine(a), // who would hear a say or a shout, who to talk to, who is out of range (#395); null when nobody is near; heard/met: what was said lately and who it has met (sim/talk.js), so a trimmed context does not re-introduce itself
    ...hallBrief(a), // hall:[{id,title,giver,reward}] for a Fellowship member in town when its hall posts jobs for the Fellowship (#326); absent otherwise
    quest:questBrief(a), // {focus, id, others}: the quest in focus and how many more it holds (sim/questlog.js)
    reflect:reflectDue(a)}}} // a moment to write memories (#179): {id, kind, why} or null; the runner closes it with pace {reflected}
// The hall's open jobs that concern the Fellowship (issue #326), as the board shows them to a member standing in town:
// a job for one of the five, the hall's Fellowship job, or one in a region they ride or work in. Only what the posting
// says (id, title, giver, reward), never who posted it behind the scenes (in-game channels, #123). Reads only; at most
// PACE.HALL, the hall's own Fellowship jobs first. {} when the hero is no member, is not in town, or nothing is posted.
function hallBrief(a){if(!a.fellow||a.state!=='town'||!S.fellowship)return {};const f=focus();if(!f)return {};
  const town=homeOf(a);if(!town||town.name!==S.fellowship.hall)return {};
  const L=hallHooks(town.name,f); // one selection with the watcher's Fellowship panel (#334)
  if(!L.length)return {};
  return {hall:L.slice(0,PACE.HALL).map(h=>{const o={id:'job:'+h.id,title:hallTitle(h)};if(h.giver&&h.giver.name)o.giver=h.giver.name;const r=hallPay(a,h);if(r)o.reward=r;return o})}}
function hallPay(a,h){const T=ADV.ADVENTURES[h.tpl];if(!T||!T.pay)return null;const g=Math.round((6+a.lvl*3)*T.pay.gold*(h.data&&h.data.payMul||1));
  return 'about '+g+'g and XP'+(T.pay.honor?', '+T.pay.honor+' honor':'')+(T.pay.gear>=.35?', maybe gear':'')} // the quest log's payText (sim/questlog.js), same words as list_jobs/quests
// The scene this hero still has to answer, for the runner's forced scene turn (issue #163): its legal option keys and
// texts, the frame and the beats so far (what tableView shows the hero, nothing more). null when acted or over.
function sceneOpen(a,tv){if(!tv||tv.acted||tv.phase==='outcome'||!tv.options)return null;const keys=optionsFor(S.table,a).map(o=>o.k);if(!keys.length)return null;
  return {title:tv.scene,kind:tv.kind,frame:tv.frame,phase:tv.phase,keys,options:tv.options,your_turn:!!tv.your_turn,so_far:tv.so_far||[]}}
