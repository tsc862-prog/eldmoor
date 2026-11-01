// Events for agent-played heroes (issues #75, #68): what happened to the hero, handed to its agent
// with the next tool result. Urgent events end a pending `wait` early (sim/player.js waitOver).
// Kept in its own module so the Fellowship's council and Table mode (sim/council.js,
// sim/table.js) can tell an agent "your turn" without importing the player module.
import {clockStr} from './state.js';

export const EV_MAX=40;
const clean=(s,n)=>String(s==null?'':s).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,n);

export function ev(a,text,urgent){if(!a)return;const e={n:(a.playEvN=(a.playEvN||0)+1),t:clockStr(),text:clean(text,240)};if(urgent)e.u=1;
  (a.playEv||(a.playEv=[])).push(e);if(a.playEv.length>EV_MAX)a.playEv.shift()}
// Only agent-played heroes read events; scripted heroes are skipped so their saves stay small.
export const notify=(a,text,urgent)=>{if(a&&a.player)ev(a,text,urgent)};
