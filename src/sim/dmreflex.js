// The DM's reflexes (issue #561, slice C of #520; owner decision of 2026-11-03: the DM is always an agent). Owned by
// brain-builder. DOM-free, no RNG, never saved, never read by step().
//
// There is no "no DM agent" story mode any more: the scripted DM is the world engine (boards, background adventures,
// encounters) and the DM's reflexes. Every call the game puts to the DM (a table voice slot, a staged scene's outcome
// and complication, session zero's frame, a newcomer's arrival, a townsperson's answer) waits a bounded time for the
// DM runner and is then filled by the scripted line, exactly as a member's reflex fills a Table turn. This module is
// the one place that knows whether the DM is listening:
//   - heard(kind): the DM runner just polled or called ('table' = table_call/table_answer, 'voice' = npc_call,
//     'act' = any DM tool). sim/dmagent.js stamps every call; arrival.js and staged.js stamp their table polls.
//   - alive: the host's word that a runner holds the seat (the page: the relay's claim link; none in Node).
//   - gone(): the runner is gone (the seat closed, the host saw the claim drop): every wait ends at once and the
//     reflexes fill. The world pause for a DM runner gone is the host's (the start gate, ui/rungate.js, #578), as for a
//     member; once the owner resumes, the reflexes answer until a runner holds the seat again.
// A world no DM runner ever listened to (npm run sim, the seeded checks) never waits: every call is filled at once,
// so its hashes do not move. Every fill is logged in the DM log with fill:true and why ('slow': the DM was waited for
// and stayed silent; 'gone': nobody was listening), and counted by the DM-share digest (sim/behavior.js, #541).
let at={table:0,voice:0,act:0},aliveFn=null,epoch=0;
export function heard(kind){const now=Date.now();if(kind in at)at[kind]=now;at.act=now}
// Real ms since the DM was last heard of this kind (Infinity: never, or not since it went away).
export const since=kind=>at[kind]>0?Date.now()-at[kind]:Infinity;
export const heardWithin=(kind,ms)=>since(kind)<ms;
// The host's word that a runner holds the DM seat (connected or waiting), the page's ui/runalert.js. Null in Node.
export function setDmAlive(f){aliveFn=typeof f==='function'?f:null}
export const dmAlive=()=>!!(aliveFn&&aliveFn());
// The runner is gone: forget every stamp, so nothing waits for it any more.
export function gone(){at={table:0,voice:0,act:0};epoch++}
export const goneEpoch=()=>epoch;
// A table call (session zero, an arrival, a staged scene) waits while the DM polled the table within pollMs, or while
// a runner holds the seat (a busy runner gets its TABLE.dmMs per call), until it has missed missMax calls in this scene.
export const tableLive=(sc,missMax,pollMs)=>(sc.dmMiss||0)<missMax&&(heardWithin('table',pollMs)||dmAlive());
// Why a call is being filled by the scripted DM: it waited (c.t > 0) and the DM stayed silent, or nobody listened.
export const fillWhy=c=>c&&c.t>0?'slow':'gone';
// The budget clock starts at pickup (#680): a call's answer time counts from the moment a runner first reads it (seen), not
// from when the game posted it, so a slow poll costs nothing; a hard cap of the budget plus PICKUP_MS from the post still
// ends the wait for a runner that never picks it up. All in one unit (ms of Date.now, or seconds of a scene's clock).
export const PICKUP_MS=4000;
export const callDeadline=(open,ms,seen,pickup=PICKUP_MS)=>seen!=null?Math.min(seen+ms,open+ms+pickup):open+ms+pickup;
// Words for a scripted fill after a wait (the DM log): never picked up, or picked up and not answered in time.
export const lateWhy=seen=>seen!=null?'no answer in time':'late pickup';
