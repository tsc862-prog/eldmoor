// Events for agent-played heroes (issues #75, #68): what happened to the hero, handed to its agent
// with the next tool result. Urgent events end a pending `wait` early (sim/player.js waitOver).
// Kept in its own module so the Fellowship's council and Table mode (sim/council.js,
// sim/table.js) can tell an agent "your turn" without importing the player module.
// Runner pacing (issue #126): an event also says whether it should start the agent's next turn
// (sim/pace.js). urgent=2 marks the ones that cannot wait (attacked, badly hurt, a choice, a table
// scene, a camp alarm: e.w=2, a turn at once; urgent=3 for a choice or a table turn, which must be answered
// in time: e.w=3, at once even when the runner has used up its immediate turns); other urgent events and the `wake` ones (a party line,
// the narrator, a person speaking to the hero) start a turn once the runner's minimum gap has passed.
import {clockStr} from './state.js';

export const EV_MAX=40;
const clean=(s,n)=>String(s==null?'':s).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,n);

export function ev(a,text,urgent,wake){if(!a)return;const e={n:(a.playEvN=(a.playEvN||0)+1),t:clockStr(),text:clean(text,240)};if(urgent)e.u=1;
  if(urgent===3||wake===3)e.w=3;else if(urgent===2||wake===2)e.w=2;else if(wake)e.w=1;
  (a.playEv||(a.playEv=[])).push(e);if(a.playEv.length>EV_MAX)makeRoom(a)}
// A full list gives up what matters least (the #819 flake, a live bug: chatter pushed unread news out, so the turn it was to
// start never came): the oldest event already read, else the oldest of the lowest wake level. Never the one just added.
function makeRoom(a){const L=a.playEv,seen=a.playEvSeen||0;let at=0,low=Infinity;
  for(let i=0;i<L.length-1;i++){const l=L[i].n<=seen?-1:wakeLevel(L[i]);if(l<low){low=l;at=i;if(l<0)break}}
  L.splice(at,1)}
// Only agent-played heroes read events; scripted heroes are skipped so their saves stay small.
export const notify=(a,text,urgent,wake)=>{if(a&&a.player)ev(a,text,urgent,wake)};
// How strongly an event calls for the agent's next turn: 2 at once, 1 after the runner's gap, 0 not at all.
// An event that should no longer start a turn (#682): a vote that became a Table scene wakes its members with the scene's frame
// instead, once the DM has set it. The text stays for the agent to read; only its wake is dropped.
export function hush(a,pred){if(!a||!a.playEv)return;for(const e of a.playEv)if(pred(e)){delete e.w;delete e.u}}
export const wakeLevel=e=>e?e.w||(e.u?1:0):0; // 3 must answer now, 2 at once, 1 after the gap, 0 never
// The events to show when there are more than n, in order: every one that wakes a turn, then the newest of the rest. Reading
// marks all of them seen, so a line cut here is never told: news is not cut, however many there are (at most EV_MAX).
export function mostNews(L,n){if(L.length<=n)return L;let room=n-L.filter(wakeLevel).length;const keep=new Set();
  for(let i=L.length-1;i>=0;i--)if(wakeLevel(L[i]))keep.add(L[i]);else if(room-->0)keep.add(L[i]);
  return L.filter(e=>keep.has(e))}
