// The run gate (#171): the world only runs while every required agent seat is connected.
// Required seats: each living Fellowship member (always agent-played, #148) and the DM seat when the DM agent is
// chosen. A seat counts as connected when its link, from the relay's claims (ui/player-bridge.js), is 'connected' or
// 'waiting'. While any seat is missing, ctl.held is true: main.js does not step the sim and the speed buttons cannot
// unpause. ctl.speed keeps the owner's wish, so when the last seat connects the world resumes by itself, and a world the
// owner had paused stays paused. A seat that was live in the last GRACE ms (30 s, unless the relay reports its runner stopped or crashed) (a claim refresh missed, a runner restarting
// between turns) still counts, so a short blip does not flicker the gate. A new world or a reload starts closed.
// The Developer switch "Run without agents" (this session only) turns the gate off, and then reflexes decide for any
// member without a runner (sim/runlink.js setReflexAck). A bar over the map lists who is missing and why, with
// Start / Restart per seat and Start all. The bar is patched only when its text changes.
// Ready, not just claimed (issue #222): a connected seat still holds the world until its runner has completed one
// warm-up model call (POST /play/ready on the relay: 'warming' -> 'ready' | 'failed'). That covers Continue, a new
// world and any runner (re)start, since readiness belongs to the runner that reported it. "Start anyway" waives the
// wait for the seats as they are now: a waived connected seat must warm up again only after its runner goes away; a
// waived missing seat holds again once a runner claims it (until that runner is ready).
// The DM prepares the table (issue #437, owner decision of 2026-11-03): once every seat is ready (or waived) and the DM
// seat's runner is ready, the world stays held while the DM takes one bounded prep turn (sim/prep.js: about 90 s and 20
// calls, half on Continue or for a DM runner started again; the call cap is counted in sim/dmagent.js). The bar reads
// "THE DM PREPARES THE TABLE" with the time and calls and keeps Start anyway (it ends the prep). Then the opening scene
// opens (sim/arrival.js) and the clock runs. A closed DM seat, or a DM seat waived without a ready runner: no prep.
// The DM is always an agent (#520, slice A #559): a played world has its DM seat open, so the gate always counts it. The
// page opens the seat once per world it plays (ensureDmSeat: a new world from the setup page already has it open; an
// older world on Continue gets it here). Until slice B (#560) the panel's Close seat still works for this session.
// While the gate or the prep holds the world, agent heroes get no turns and their acting tools are refused
// (sim/prep.js setGateHold, #559), so nobody speaks or moves before the opening scene.
import {S,dmSeatOn,beginPrep,endPrep,prepTick,prepView,prepActive,openingDue,setPrepHost,setGateHold} from '../sim/index.js';
import {runnerFor,runnerByKey,relayUp,runnersEnabled,ollamaBusy,reasonOf,watchRunners,DONE_STATE,leftOf} from './runners.js';
import {agentLink,dmLink,bridgeStatus,agentReady,dmReady,dmSeatSet} from './player-bridge.js';
import {ctl} from './controls.js';

const $=id=>document.getElementById(id);
const el=(tag,cls,text)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(text!=null)d.textContent=text;return d};
export const GRACE=30000; // a blip shorter than this never closes the gate (a real stop, a runner the relay reports stopped or crashed, closes it at once)
const LIVE={connected:1,waiting:1};
let free=false,lastLive={},missing=[],checkAt=0,sig='',closeCb=null,probe=null,total=0,readyN=0,prepSig=null,prepping=false;
const anyway=new Map(),lastRd={}; // seat key -> 'missing' | 'live': waived by Start anyway (#222)
// Developer switch, this session only (a stale "off" must never leave a real run unguarded after a reload).
export const runFree=()=>free;
export function setRunFree(v){free=!!v;checkAt=0;const b=$('wFree');if(b){b.setAttribute('aria-pressed',String(free));b.textContent='Run without agents: '+(free?'on':'off')}}
export const gateMissing=()=>missing;
export const onGateClose=fn=>{closeCb=fn};
// Test seam (scripts/uismoke.mjs): {link(a), dm(), ready?(a), dmReady?()} replaces the relay's links (a probe without
// ready functions counts every live seat as ready, as before #222).
export const setGateProbe=p=>{probe=p||null;anyway.clear()};
const linkOf=a=>probe?probe.link(a):agentLink(a),dmOf=()=>probe?probe.dm():dmLink();
const READY={state:'ready'};
const readyOf=a=>probe?(probe.ready?probe.ready(a):READY):agentReady(a),dmReadyOf=()=>probe?(probe.dmReady?probe.dmReady():READY):dmReady();
// 'ready' | 'warming' | 'failed' | 'claimed' (connected, no warm-up reported yet) for a connected seat
const stateOf=s=>s.ready&&s.ready.state?s.ready.state:'claimed';
export const gateCounts=()=>({ready:readyN,total});

let seatFor=null; // the world (S.worldId) whose DM seat this page opened
export function ensureDmSeat(){if(probe||!S.agents||!S.agents.length)return false;const w=S.worldId||'world';if(seatFor===w)return false;seatFor=w;
  if(dmSeatOn())return false;dmSeatSet(true);return true}
export function seats(){const out=[];
  for(const a of S.agents)if(a.fellow&&a.player&&a.state!=='dead')out.push({key:'hero:'+a.id,kind:'hero',hero:a.id,name:a.name,a,link:linkOf(a),ready:readyOf(a)});
  if(dmSeatOn())out.push({key:'dm',kind:'dm',name:'DM',link:dmOf(),ready:dmReadyOf()});
  return out}

// Why a seat is not connected, in the owner's words.
export function whyMissing(s){
  if(s.live){const st=stateOf(s),r=s.ready||{},m=r.model||'its model';
    if(st==='warming')return 'loading '+m+(r.at?' ('+Math.max(0,Math.round((Date.now()-r.at)/1000))+' s)':'')+'…';
    if(st==='failed')return 'warm-up failed'+(r.error?': '+r.error:'')+' (Restart, or Start anyway)';
    return 'claimed, waiting for its first model answer (an older runner never reports one: Start anyway)'}
  if(!probe){const bs=bridgeStatus();if(bs==='connecting')return 'connecting to the relay…';if(bs!=='connected'||relayUp()===false)return 'the relay is offline (npm run relay -- --runners)'}
  const r=s.kind==='dm'?runnerByKey('dm'):runnerFor(s.a);
  const lf=s.a&&leftOf(r,s.a);if(lf&&!DONE_STATE[r.state])return 'the Fellowship runner is done with '+s.name+' ('+lf.why+'): Restart it to play on'; // #563
  if(r&&r.state==='crashed')return reasonOf(r,s.a||null);
  if(r&&r.state==='starting')return 'starting…';
  if(r&&r.state==='stopping')return 'stopping…';
  if(r&&!DONE_STATE[r.state]){if(s.a&&ollamaBusy(s.a))return 'Ollama is busy or loading its model';return 'runner is up, waiting for it to claim'}
  if(r&&r.state==='stopped')return reasonOf(r,s.a||null);
  if(!probe&&!runnersEnabled()&&relayUp())return 'runners are off on the relay (start it with --runners)';
  return 'no runner'}

// Recompute the gate. Cheap; called every frame, works at most once a second unless forced by now.
export function checkRunGate(now=Date.now()){
  if(now-checkAt<1000&&!probe)return;checkAt=now;
  ensureDmSeat();
  const L=seats();let list=[];
  if(L.length&&!probe)watchRunners();
  let nReady=0;
  for(const s of L){if(LIVE[s.link])lastLive[s.key]=now;
    const r=LIVE[s.link]||probe?null:s.kind==='dm'?runnerByKey('dm'):runnerFor(s.a),gone=!!(r&&(DONE_STATE[r.state]&&r.state!=='starting'||s.a&&leftOf(r,s.a))); // a runner the relay reports stopped or crashed, or one that let this member go (#563), closes at once, no grace
    const live=LIVE[s.link]||(!gone&&lastLive[s.key]!=null&&now-lastLive[s.key]<GRACE);s.live=!!live;
    if(LIVE[s.link])lastRd[s.key]=s.ready||null;else if(live&&!s.ready)s.ready=lastRd[s.key]||null; // a short blip keeps the last readiness too
    const w=anyway.get(s.key);if(w==='missing'&&live)anyway.delete(s.key);if(w==='live'&&!live)anyway.delete(s.key); // a new runner warms up again
    const ok=live&&stateOf(s)==='ready';if(ok)nReady++;
    if(!ok&&!anyway.has(s.key))list.push(s)}
  for(const k in lastLive)if(!L.some(s=>s.key===k)){delete lastLive[k];delete lastRd[k]}
  for(const k of [...anyway.keys()])if(!L.some(s=>s.key===k))anyway.delete(k);
  total=L.length;readyN=nReady;
  if(free)list=[];
  // the DM's prep (#437): once per ready DM runner (a new runner reports a new readiness), the full one on a new world
  prepTick();const dm=L.find(s=>s.kind==='dm');
  if(prepActive()&&(free||!dm||!dm.live))endPrep('seat');
  if(!prepActive()&&!list.length&&!free&&dm&&dm.live&&stateOf(dm)==='ready'&&dm.ready!==READY){const k=JSON.stringify(dm.ready||{});if(k!==prepSig){prepSig=k;beginPrep(openingDue()?'opening':'resume')}} // READY: a test probe's stand-in, not a runner's report
  prepping=prepActive()&&!list.length;
  const was=ctl.held;
  missing=list;ctl.held=list.length>0||prepping;setGateHold(list.length>0); // the prep holds by itself (sim/prep.js)
  if(ctl.held!==was){for(const b of document.querySelectorAll('[data-sp]'))if(+b.dataset.sp>0){if(ctl.held)b.setAttribute('aria-disabled','true');else b.removeAttribute('aria-disabled')}}
  if(ctl.held&&!was&&closeCb&&list.length)closeCb(list);
  paint()}

const setupOpen=()=>{const s=$('setup');return !!(s&&!s.hidden)};
function paint(){const box=$('rgate');if(!box)return;
  const show=ctl.held&&!setupOpen();
  const pv=prepping?prepView():null;
  const s=show?missing.map(m=>m.key+'='+m.link+'='+whyMissing(m)).join('|')+'|'+ctl.speed+'|'+readyN+'/'+total+(pv?'|prep:'+pv.seconds+':'+pv.calls:''):'';
  if(s===sig)return;sig=s;
  if(!show){box.hidden=true;box.replaceChildren();return}
  box.hidden=false;box.replaceChildren();
  if(pv){box.append(el('div','rt','THE DM PREPARES THE TABLE · '+pv.seconds+' S · '+pv.calls+'/'+pv.max_calls+' CALLS'));
    box.append(el('div','rl dm',(pv.kind==='opening'?'The DM reads the world and the campaign and writes its plans; the opening scene follows.':'The DM re-reads where the companies are before the clock runs.')+' At most '+pv.max_seconds+' s.'));
    const go=el('button','mini runbtn','Start anyway');go.dataset.gateanyway='1';go.title='End the prep of the DM now and open the table';const bt=el('div','rb');bt.append(go);box.append(bt);return}
  const paused=ctl.speed===0;
  box.append(el('div','rt','WAITING FOR MINDS · '+readyN+'/'+total+' READY'));
  box.append(el('div','rl dm',paused?'Paused. It will stay paused once every mind is ready.':'The world runs by itself once every mind has connected and answered once.'));
  for(const m of missing){const row=el('div','rl rgrow');row.append(el('span','rgn',m.name),el('span','rgw',': '+whyMissing(m)));
    const r=m.kind==='dm'?runnerByKey('dm'):runnerFor(m.a),running=r&&!DONE_STATE[r.state]&&r.state!=='stopping';
    const kind=running&&r.kind!=='hero'?r.kind:m.kind; // a member the Fellowship runner plays (or let go): restart that runner (#563)
    const b=el('button','mini runbtn',running?'Restart':'Start');b.dataset.runact=running?'restart':'start';b.dataset.runkind=kind;if(m.hero!=null&&kind==='hero')b.dataset.runhero=m.hero;
    b.title=running?'Stop this runner and start it again':'Start the runner from the relay';row.append(b);box.append(row)}
  const all=el('button','mini runbtn','Start all');all.dataset.gateall='1';all.title='Start the Fellowship runner (all five) and the DM runner for every seat that is missing';
  const go=el('button','mini runbtn','Start anyway');go.dataset.gateanyway='1';go.title='Run the world now with the minds as they are (members without a ready runner act by reflex until theirs is ready)';
  const bt=el('div','rb');bt.append(all,go);box.append(bt)}

// Start anyway (#222): waive the wait for every seat that holds the world now.
export function startAnyway(){if(prepping&&!missing.length){endPrep('anyway');prepping=false}for(const m of missing)anyway.set(m.key,m.live?'live':'missing');checkAt=0;sig=null;checkRunGate(Date.now())}
export const gatePrep=()=>prepping?prepView():null; // the smoke check and the panels

// Start all: one Fellowship runner for the members, the DM runner for the DM, only where a seat is missing.
export async function startAllMissing(start){
  const fel=missing.some(m=>m.kind==='hero'),dm=missing.some(m=>m.kind==='dm');
  if(fel)await start('fellowship');if(dm)await start('dm')}

export function initRunGate(start){setPrepHost(true); // this page holds the world for the DM's prep (#437)
  const box=$('rgate');
  if(box)box.addEventListener('click',e=>{const t=e.target&&e.target.closest?e.target.closest('[data-gateall]'):null;if(t&&start)startAllMissing(start).then(()=>{sig='';checkAt=0});
    if(e.target&&e.target.closest&&e.target.closest('[data-gateanyway]'))startAnyway()});
  const b=$('wFree');if(b)b.onclick=()=>setRunFree(!free);
  checkRunGate(Date.now())}
