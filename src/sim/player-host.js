// Agent player (issue #75): one tool call, start to finish, for whichever process hosts the
// world (the browser page through src/ui/player-bridge.js, or scripts/play-headless.mjs).
// DOM-free and outside the step loop: it only reads and writes through sim/player.js and
// uses timers, so the world keeps stepping while a `wait` is pending.
import {playerAct,waitOver,finishWait} from './player.js';
import {paceCheck,paceIdle,paceBrief,PACE} from './pace.js';

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
  const p=args&&typeof args==='object'?args:{};if(p.brief)return paceBrief(heroId); // the state header for a turn prompt, at once
  const t0=now(),rm=Number(p.realMs),realMs=Math.min(PACE.REAL_MAX,Number.isFinite(rm)&&rm>=0&&p.realMs!==null?rm:PACE.REAL_MS);
  const q={since:Number.isFinite(Number(p.since))&&p.since!==null?Number(p.since):paceIdle(heroId,null).since,minutes:p.minutes,wake:p.wake==='now'?'now':'all'};
  for(;;){const r=paceCheck(heroId,q);if(r)return r;
    if(now()-t0>=realMs)return paceIdle(heroId,q.since);await nap(poll)}}
