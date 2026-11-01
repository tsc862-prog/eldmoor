// Agent player (issue #75): one tool call, start to finish, for whichever process hosts the
// world (the browser page through src/ui/player-bridge.js, or scripts/play-headless.mjs).
// DOM-free and outside the step loop: it only reads and writes through sim/player.js and
// uses timers, so the world keeps stepping while a `wait` is pending.
import {playerAct,waitOver,finishWait} from './player.js';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));

// Returns a promise of the tool's result. `wait` resolves when its game time has passed,
// something urgent happened, the hero died, or realMs of real time ran out (a paused world).
export async function hostCall(heroId,tool,args,{poll=100,nap=sleep,now=()=>Date.now()}={}){
  const r=playerAct(heroId,tool,args||{});
  if(!r||!r.pending)return r;
  const p=r.pending,t0=now();
  while(!waitOver(p)){if(now()-t0>=p.realMs)return finishWait(p,true);await nap(poll)}
  return finishWait(p,false)}
