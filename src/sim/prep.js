// The DM's prep before the table opens (issues #437 and #452; owner decision of 2026-11-03 on #437). Owned by
// ai-designer (the sequence) with brain-builder (the runner side, scripts/dm-agent.mjs). DOM-free, no RNG.
//
// The sequence of a new world: the start gate is ready (every seat ready or waived, src/ui/rungate.js) -> the DM
// prepares -> the opening Table scene (sim/arrival.js) -> the clock runs. While the DM prepares, the host keeps the
// world held (the page's gate, play-headless --wait-ready), so what the DM reads cannot go stale.
//   - Only with its runner there (the DM is always an agent, #559/#561). With no runner (the owner resumed without one, or a
//     host with no gate) there is no prep, and the DM's reflexes frame the opening (sim/arrival.js, sim/dmreflex.js).
//   - Bounded hard: PREP.MS real milliseconds and PREP.CALLS tool calls (idle table/npc polls and prep_done do not
//     count). Whichever comes first ends it, as does the DM ending its turn (prep_done) or the owner's Start anyway.
//   - The clock starts at the DM's first counted call, not at the gate (#733): a runner that waited for a Claude slot or a
//     slow first model call still gets its PREP.MS. PREP.HARD_MS from the gate ends a prep whose DM never begins or runs
//     late (why 'hard'), so a missing DM cannot hold the world. The runner's own wait for the prep (dm_status {_poll:true})
//     neither counts nor starts the clock.
//   - A new world gets the full prep ('opening'); Continue and a DM runner started again mid-session get a short one
//     ('resume': one turn, half the caps) to re-read where the companies are.
// State lives here, not on S: it is about the runner in the seat now, so it is never saved and never read by step().
export const PREP={MS:90000,CALLS:20,SHORT:.5,HARD_MS:180000}; // DM_PREP_MS, DM_PREP_CALLS (owner: about 90 s and about 20 calls); HARD_MS from the gate (#733)
const IDLE={table_call:1,npc_call:1,ruling_call:1,companion_call:1,prep_done:1,turn_end:1};
let P=null; // {kind, since (the gate), at (the first call, or null), calls, maxCalls, ms, hardMs, state:'running'|'done', why, ended}
let last=null; // the last prep that ended, for the panels and the checks
let clock=()=>Date.now(),host=false;
// A host that holds the world for the prep (the page's run gate, play-headless --wait-ready) says so, so a DM runner knows
// to wait for it before its first turn; with no such host no prep ever starts and the runner does not wait.
export const setPrepHost=v=>{host=!!v};
export const setPrepClock=f=>{clock=typeof f==='function'?f:()=>Date.now()}; // test seam
export const prepActive=()=>!!(P&&P.state==='running');
// Start a prep: kind 'opening' (full caps) or 'resume' (half). Returns the view. A running prep is left as it is.
export function beginPrep(kind){if(prepActive())return prepView();const short=kind!=='opening';
  P={kind:short?'resume':'opening',since:clock(),at:null,calls:0,maxCalls:Math.max(1,Math.round(PREP.CALLS*(short?PREP.SHORT:1))),ms:Math.round(PREP.MS*(short?PREP.SHORT:1)),hardMs:Math.round(PREP.HARD_MS*(short?PREP.SHORT:1)),state:'running',why:null};
  return prepView()}
// End it: 'done' (the DM ended its turn), 'calls' / 'time' (a cap), 'hard' (PREP.HARD_MS from the gate), 'anyway' (Start
// anyway), 'seat' (the seat closed or its runner went away). Returns true when a running prep ended.
export function endPrep(why){if(!prepActive())return false;P.state='done';P.why=String(why||'done');P.ended=clock();last=P;P=null;return true}
// A DM tool call during the prep: the first one starts the clock (#733), each is counted against the cap; the cap ends it.
// args._poll: the runner waiting for the prep to begin (scripts/dm-agent.mjs waitPrep), not a call of its turn.
export function prepCall(tool,args){if(!prepActive()||IDLE[tool]||(args&&args._poll===true))return;if(P.at==null)P.at=clock();P.calls++;if(P.calls>=P.maxCalls)endPrep('calls')}
// The host's tick: the time cap from the first call, the hard cap from the gate.
export function prepTick(){if(!prepActive())return;const now=clock();if(P.at!=null&&now-P.at>=P.ms)endPrep('time');else if(now-P.since>=P.hardMs)endPrep('hard')}
const prepLeft=now=>Math.max(0,Math.min(P.hardMs-(now-P.since),P.at==null?P.ms:P.ms-(now-P.at)));
// What the seat, the banner and /play/health see.
export function prepView(){const now=clock();
  // seconds: since the DM's first call (0 until it comes); started false while the gate's hard cap is the only clock running
  if(prepActive())return {host:true,state:'running',kind:P.kind,calls:P.calls,max_calls:P.maxCalls,started:P.at!=null,seconds:P.at==null?0:Math.round((now-P.at)/1000),max_seconds:Math.round(P.ms/1000),seconds_left:Math.round(prepLeft(now)/1000),waited:Math.round(((P.at==null?now:P.at)-P.since)/1000),hard_left:Math.max(0,Math.round((P.hardMs-(now-P.since))/1000))};
  const h=host?{host:true}:{};
  return last?{...h,state:'done',kind:last.kind,why:last.why,calls:last.calls,max_calls:last.maxCalls,seconds:Math.round((last.ended-(last.at==null?last.ended:last.at))/1000),waited:Math.round(((last.at==null?last.ended:last.at)-last.since)/1000)}:{...h,state:'idle'}}
export const lastPrep=()=>last?{...last}:null;
// The world held before play (#559, owner bug of 2026-11-03: members introduced themselves while the DM prepared, then
// again at the opening scene). The host says when its start gate holds the world (the page's rungate, play-headless
// --wait-ready); the DM's prep holds it by itself. While held, agent heroes get no paced turn (sim/pace.js) and their
// world-changing or speaking tools are refused with holdLine() (sim/player.js); read-only tools still answer.
// Never saved, never read by step(): a host with no gate (npm run sim, the checks) is never held.
let gateHold=false;
export const setGateHold=v=>{gateHold=!!v};
export const worldHeld=()=>prepActive()?'prep':gateHold?'gate':null;
export const HOLD_LINE={prep:'The DM is preparing the table; wait for the opening scene.',
  gate:'The world is held until every mind is ready and the DM has prepared the table; wait (the opening scene comes first).'};
export const holdLine=()=>{const w=worldHeld();return w?HOLD_LINE[w]:null};
export function resetPrep(){P=null;last=null;gateHold=false}
