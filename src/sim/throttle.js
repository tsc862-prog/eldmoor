// Request throttle (issue #117). Owned by brain-builder. DOM-free, RNG-free.
// Every model request the sim makes goes through here for three things:
//   - a speed-aware clock: `vt` counts "real seconds at the player's speed" (sim seconds / speed),
//     so caps mean the same wall-clock rate at 1x, 3x and 8x, and a headless run at 8x measures
//     what a browser at 8x would send;
//   - caps for chatter (`sayOk`: per hero and global gaps; wider at 3x/8x);
//   - backoff for writing kinds (persona, backstory, memory) per hero after a failed, 429 or
//     timed-out answer, doubling to a cap, plus a short global pause when the relay says rate limit;
//   - a rolling log (requests per minute, recent failures) for the Mind tab and Fellowship panel.
// None of it touches RNG or sim state; a denied ask simply leaves the scripted text/summary in place.
let speedFn=()=>1;
export const setSpeedSource=f=>{speedFn=f};
export const speedNow=()=>{const s=+speedFn();return s>0?s:1};

export const LIM={sayHero:20,sayGlobal:3,fastMul:3,backoff0:15,backoffMax:300,globalPause:30,globalPauseMax:240,window:60,failKeep:8};
let vt=0,reqs=[],fails=[],lastSayHero=new Map(),lastSayAll=-1e9,bo=new Map(),gPause=0,gStep=0;
const tot={sent:0,ok:0,failed:0,denied:0,byKind:{}};
export const totals=tot;
const kindOf=k=>tot.byKind[k]||(tot.byKind[k]={sent:0,failed:0,denied:0});
export function resetThrottle(){vt=0;reqs=[];fails=[];lastSayHero=new Map();lastSayAll=-1e9;bo=new Map();gPause=0;gStep=0;
  tot.sent=tot.ok=tot.failed=tot.denied=0;tot.byKind={}}
// dt: sim seconds of the step. The table pauses the world at 1x (no step), so it adds nothing.
export const tick=dt=>{vt+=dt/speedNow()};
export const vtNow=()=>vt;

const hid=h=>h&&typeof h==='object'?h.id:h;
const fastMul=()=>speedNow()>=3?LIM.fastMul:1;

// ---- accounting ----
export function sent(kind){tot.sent++;kindOf(kind).sent++;reqs.push(vt);while(reqs.length&&vt-reqs[0]>LIM.window)reqs.shift()}
export function denied(kind){tot.denied++;kindOf(kind).denied++}
// Requests in the last minute (scaled while less than a minute has passed).
export const rpm=()=>{while(reqs.length&&vt-reqs[0]>LIM.window)reqs.shift();return vt<LIM.window?Math.round(reqs.length*60/Math.max(10,vt)):reqs.length};
export const recentFailures=()=>fails.slice();
export function ok(kind,hero){tot.ok++;bo.delete(kind+':'+hid(hero));if(gStep&&vt>=gPause)gStep=0}
// A failed answer. why: the relay's error text or 'timeout' / 'unreachable'.
export function fail(kind,hero,why){tot.failed++;kindOf(kind).failed++;
  const w=String(why||'failed').slice(0,80);fails.unshift({vt:Math.round(vt),kind,hero:hero&&hero.name?hero.name:hid(hero),why:w});if(fails.length>LIM.failKeep)fails.pop();
  const k=kind+':'+hid(hero),b=bo.get(k)||{n:0,until:0};b.n++;b.until=vt+Math.min(LIM.backoffMax,LIM.backoff0*2**(b.n-1));bo.set(k,b);
  if(/429|rate|overload|busy|quota|limit/i.test(w)){gStep++;gPause=vt+Math.min(LIM.globalPauseMax,LIM.globalPause*2**(gStep-1))}}

// ---- gates ----
// Writing kinds (persona, backstory, memory, say): blocked while this hero's backoff or the global pause runs.
export function blocked(kind,hero){const b=bo.get(kind+':'+hid(hero));return vt<gPause||(!!b&&vt<b.until)}
export const backoffLeft=(kind,hero)=>{const b=bo.get(kind+':'+hid(hero));return Math.max(0,Math.round(Math.max(gPause,b?b.until:0)-vt))};
// Chatter: one line per hero per sayHero seconds and one per sayGlobal seconds (x3 at 3x/8x), none
// during backoff. Reserves the slot when it says yes.
export function sayOk(hero){const id=hid(hero),m=fastMul();
  if(blocked('say',hero)||blocked('say',null)||vt-(lastSayHero.has(id)?lastSayHero.get(id):-1e9)<LIM.sayHero*m||vt-lastSayAll<LIM.sayGlobal*m){denied('say');return false}
  lastSayHero.set(id,vt);lastSayAll=vt;return true}
