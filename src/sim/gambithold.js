// Gambit hold (issue #630): the rule action `hold` calls the hero's own mind (an urgent wake, like wake_me) and also stops the
// world clock, as a Table decision does, until the agent's next acting tool call lands, GAMBIT.HOLD_MAX_S real seconds pass,
// or the runner is gone (then it releases at once and the reflexes play). One hold at a time. The world is stopped, so nothing
// can strike the hero meanwhile: the hold is never a death sentence. No RNG; state is S.gambitHold (not saved: a reload
// starts unheld). A hold at a Table scene or without a live runner never starts. The class presets use no hold, so a seeded
// world is unchanged. Finished holds go to S.gambitStats and a small ring the behavior watch drains.
import {S} from './state.js';
import {GAMBIT} from '../data/gambits.js';
import {agentLive} from './runlink.js';
import {sceneOf} from './scenes.js';
import {TABLE,requestDrop} from './table.js';
import {ruleText} from './gambits.js';

const stats=()=>S.gambitStats||(S.gambitStats={edits:0,safety:0,resets:0,refused:0});
const today=()=>Math.floor(S.gameMin/1440)+1;
const byId=id=>S.agents.find(x=>x.id===id)||null;

// Start a hold for hero a on a rule: {ok:true} or {ok:false, why}. Does not wake (the action does).
export function holdStart(a,rule){
  if(S.gambitHold)return {ok:false,why:S.gambitHold.id===a.id?'already holding':'another hero holds the world'};
  if(!agentLive(a))return {ok:false,why:'no runner'};
  if(sceneOf(a))return {ok:false,why:'a Table scene already waits'};
  const d=a.holdDay&&a.holdDay.d===today()?a.holdDay:(a.holdDay={d:today(),n:0});
  if(d.n>=GAMBIT.HOLD_PER_DAY)return {ok:false,why:'the day\'s holds are used'};
  d.n++;stats().holds=(stats().holds||0)+1;
  S.gambitHold={id:a.id,name:a.name,rid:rule.id,rule:ruleText(rule),at:S.gameMin,s:0};
  return {ok:true}}

// Finish the hold: how = answered | expired | no-runner | scene | owner | gone
export function holdRelease(how){const h=S.gambitHold;if(!h)return null;S.gambitHold=null;
  const st=stats();st.heldS=(st.heldS||0)+h.s;if(how==='expired')st.holdExpired=(st.holdExpired||0)+1;
  const ring=st.holdLog||(st.holdLog=[]);ring.push({id:h.id,name:h.name,rule:h.rule,s:Math.round(h.s),how,at:Math.round(S.gameMin)});while(ring.length>20)ring.shift();
  return {...h,how}}
// The agent's acting tool call landed (sim/player.js playerAct)
export const holdAnswered=a=>{if(S.gambitHold&&S.gambitHold.id===a.id)holdRelease('answered')};
// The owner's override: Resume anyway
export const holdResume=()=>holdRelease('owner');
// Behavior watch: the finished holds since the last drain
export function drainHolds(){const st=S.gambitStats,r=st&&st.holdLog;if(!r||!r.length)return [];const out=r.splice(0,r.length);return out}

// Called first in step(): true while the world is held (the clock does not run).
export function holdTick(dt){const h=S.gambitHold;if(!h)return false;
  const a=byId(h.id);
  if(!a||a.state==='dead'||!a.player){holdRelease('gone');return false}
  if(!agentLive(a)){holdRelease('no-runner');return false}
  if(sceneOf(a)){holdRelease('scene');return false}
  h.s+=dt;
  if(h.s>=GAMBIT.HOLD_MAX_S){holdRelease('expired');return false}
  if(TABLE.speed>1)requestDrop('held for '+h.name); // the host drops to 1x, as for a Fellowship decision
  return true}

// The hold as the hero's view and the banner read it, or null
export function holdView(a){const h=S.gambitHold;if(!h||(a&&a.id!==h.id))return null;
  return {hero:h.name,rule:h.rule,rid:h.rid,seconds:Math.round(h.s),max:GAMBIT.HOLD_MAX_S}}
