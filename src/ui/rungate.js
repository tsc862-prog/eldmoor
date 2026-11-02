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
import {S,dmSeatOn} from '../sim/index.js';
import {runnerFor,runnerByKey,relayUp,runnersEnabled,ollamaBusy,reasonOf,watchRunners,DONE_STATE} from './runners.js';
import {agentLink,dmLink,bridgeStatus} from './player-bridge.js';
import {ctl} from './controls.js';

const $=id=>document.getElementById(id);
const el=(tag,cls,text)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(text!=null)d.textContent=text;return d};
export const GRACE=30000; // a blip shorter than this never closes the gate (a real stop, a runner the relay reports stopped or crashed, closes it at once)
const LIVE={connected:1,waiting:1};
let free=false,lastLive={},missing=[],checkAt=0,sig='',closeCb=null,probe=null;
// Developer switch, this session only (a stale "off" must never leave a real run unguarded after a reload).
export const runFree=()=>free;
export function setRunFree(v){free=!!v;checkAt=0;const b=$('wFree');if(b){b.setAttribute('aria-pressed',String(free));b.textContent='Run without agents: '+(free?'on':'off')}}
export const gateMissing=()=>missing;
export const onGateClose=fn=>{closeCb=fn};
// Test seam (scripts/uismoke.mjs): {link(a), dm()} replaces the relay's links.
export const setGateProbe=p=>{probe=p||null};
const linkOf=a=>probe?probe.link(a):agentLink(a),dmOf=()=>probe?probe.dm():dmLink();

export function seats(){const out=[];
  for(const a of S.agents)if(a.fellow&&a.player&&a.state!=='dead')out.push({key:'hero:'+a.id,kind:'hero',hero:a.id,name:a.name,a,link:linkOf(a)});
  if(dmSeatOn())out.push({key:'dm',kind:'dm',name:'DM',link:dmOf()});
  return out}

// Why a seat is not connected, in the owner's words.
export function whyMissing(s){
  if(!probe){const bs=bridgeStatus();if(bs==='connecting')return 'connecting to the relay…';if(bs!=='connected'||relayUp()===false)return 'the relay is offline (npm run relay -- --runners)'}
  const r=s.kind==='dm'?runnerByKey('dm'):runnerFor(s.a);
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
  const L=seats();let list=[];
  if(L.length&&!probe)watchRunners();
  for(const s of L){if(LIVE[s.link])lastLive[s.key]=now;
    else{const r=probe?null:s.kind==='dm'?runnerByKey('dm'):runnerFor(s.a),gone=!!(r&&DONE_STATE[r.state]&&r.state!=='starting');
      if(gone||!(lastLive[s.key]!=null&&now-lastLive[s.key]<GRACE))list.push(s)}}
  for(const k in lastLive)if(!L.some(s=>s.key===k))delete lastLive[k];
  if(free)list=[];
  const was=ctl.held;
  missing=list;ctl.held=list.length>0;
  if(ctl.held!==was){for(const b of document.querySelectorAll('[data-sp]'))if(+b.dataset.sp>0){if(ctl.held)b.setAttribute('aria-disabled','true');else b.removeAttribute('aria-disabled')}}
  if(ctl.held&&!was&&closeCb)closeCb(list);
  paint()}

const setupOpen=()=>{const s=$('setup');return !!(s&&!s.hidden)};
function paint(){const box=$('rgate');if(!box)return;
  const show=ctl.held&&!setupOpen();
  const s=show?missing.map(m=>m.key+'='+m.link+'='+whyMissing(m)).join('|')+'|'+ctl.speed:'';
  if(s===sig)return;sig=s;
  if(!show){box.hidden=true;box.replaceChildren();return}
  box.hidden=false;box.replaceChildren();
  const paused=ctl.speed===0;
  box.append(el('div','rt','WORLD HELD · WAITING FOR AGENTS'));
  box.append(el('div','rl dm',paused?'Paused. It will stay paused once they connect.':'It runs by itself as soon as they all connect.'));
  for(const m of missing){const row=el('div','rl rgrow');row.append(el('span','rgn',m.name),el('span','rgw',': '+whyMissing(m)));
    const r=m.kind==='dm'?runnerByKey('dm'):runnerFor(m.a),running=r&&!DONE_STATE[r.state]&&r.state!=='stopping';
    const b=el('button','mini runbtn',running?'Restart':'Start');b.dataset.runact=running?'restart':'start';b.dataset.runkind=m.kind;if(m.hero!=null)b.dataset.runhero=m.hero;
    b.title=running?'Stop this runner and start it again':'Start the runner from the relay';row.append(b);box.append(row)}
  const all=el('button','mini runbtn','Start all');all.dataset.gateall='1';all.title='Start the Fellowship runner (all five) and the DM runner for every seat that is missing';
  const bt=el('div','rb');bt.append(all);box.append(bt)}

// Start all: one Fellowship runner for the members, the DM runner for the DM, only where a seat is missing.
export async function startAllMissing(start){
  const fel=missing.some(m=>m.kind==='hero'),dm=missing.some(m=>m.kind==='dm');
  if(fel)await start('fellowship');if(dm)await start('dm')}

export function initRunGate(start){
  const box=$('rgate');
  if(box)box.addEventListener('click',e=>{const t=e.target&&e.target.closest?e.target.closest('[data-gateall]'):null;if(t&&start)startAllMissing(start).then(()=>{sig='';checkAt=0})});
  const b=$('wFree');if(b)b.onclick=()=>setRunFree(!free);
  checkRunGate(Date.now())}
