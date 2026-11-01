// Events for agent-played heroes (issues #75, #68): what happened to the hero, handed to its agent
// with the next tool result. Urgent events end a pending `wait` early (sim/player.js waitOver).
// Kept in its own module so the Fellowship's council and Table mode (sim/council.js,
// sim/table.js) can tell an agent "your turn" without importing the player module.
// Runner pacing (issue #126): an event also says whether it should start the agent's next turn
// (sim/pace.js). urgent=2 marks the ones that cannot wait (attacked, badly hurt, a choice, a table
// scene, a camp alarm: e.w=2, a turn at once); other urgent events and the `wake` ones (a party line,
// the narrator, a person speaking to the hero) start a turn once the runner's minimum gap has passed.
import {clockStr} from './state.js';

export const EV_MAX=40;
const clean=(s,n)=>String(s==null?'':s).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,n);

export function ev(a,text,urgent,wake){if(!a)return;const e={n:(a.playEvN=(a.playEvN||0)+1),t:clockStr(),text:clean(text,240)};if(urgent)e.u=1;
  if(urgent===2||wake===2)e.w=2;else if(wake)e.w=1;
  (a.playEv||(a.playEv=[])).push(e);if(a.playEv.length>EV_MAX)a.playEv.shift()}
// Only agent-played heroes read events; scripted heroes are skipped so their saves stay small.
export const notify=(a,text,urgent,wake)=>{if(a&&a.player)ev(a,text,urgent,wake)};
// How strongly an event calls for the agent's next turn: 2 at once, 1 after the runner's gap, 0 not at all.
export const wakeLevel=e=>e?e.w||(e.u?1:0):0;
