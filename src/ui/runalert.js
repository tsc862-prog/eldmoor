// Alert when an agent runner stops (owner request on #136). The page already polls the runners
// (ui/runners.js) and knows each hero's link (ui/player-bridge.js). When the runner of a Fellowship
// member, the Fellowship runner (all five) or the DM runner goes from live/waiting to stopped or
// crashed, or a member's link drops to "no runner" while it is still agent-played, the world pauses
// and a bar names who stopped and why, with Restart runner / Resume without it / Dismiss, plus a
// distinct alert sound. A runner you stop yourself only gets a quiet note. Background heroes'
// runners never pause the world. The option "Alert on runner stop" is kept per viewer.
import {S,dmSeatOn} from '../sim/index.js';
import {allRunners,userStopped,watchRunners,startRunner,DONE_STATE} from './runners.js';
import {agentLink,dmLink,bridgeStatus} from './player-bridge.js';
import {ctl} from './controls.js';
import {alertCue} from './table.js';

const $=id=>document.getElementById(id);
const el=(tag,cls,text)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(text!=null)d.textContent=text;return d};
const KEY='eldmoor.runAlert';
let on=true;try{if(localStorage.getItem(KEY)==='off')on=false}catch(_){}
export const alertOn=()=>on;
const UP={starting:1,live:1,waiting:1};
const prevState={},prevLink={},recent={};
let alerts=[],prevSpeed=null,noteT=0,checkAt=0,busy=false,msg='';
const byId=id=>S.agents.find(x=>x.id==id);
const isMember=a=>!!(a&&a.fellow);

function setSpeed(v){ctl.speed=v;for(const b of document.querySelectorAll('[data-sp]'))b.setAttribute('aria-pressed',String(+b.dataset.sp===v))}

// The runner's own reason: "stopped after N turns (reason)", else the crash error, else a keyword in its last lines.
export function reasonOf(r,a){
  if(a&&a.state==='dead')return 'the hero died';
  const L=(r.lines||[]).slice(-6);
  const m=[...L].reverse().map(l=>l.match(/stopped after \d+ turns[^()]*\(([^)]+)\)/)).find(Boolean);
  if(r.state==='crashed'){const last=r.error||L[L.length-1]||(r.exit!=null?'exit '+r.exit:'');return 'crashed'+(last?': '+String(last).slice(0,160):'')}
  if(m)return m[1];
  const t=L.join(' ');
  if(/budget/i.test(t))return 'budget reached';
  if(/turn cap|max.?turns|reached .*turns/i.test(t))return 'turn cap reached';
  if(/empty|failed turns/i.test(t))return '5 empty or failed turns';
  if(/left agent play|not agent-played/i.test(t))return 'the hero left agent play';
  return 'the runner ended'+(r.exit!=null?' (exit '+r.exit+')':'')}

function whoOf(kind,hero){if(kind==='fellowship')return 'The Fellowship runner (all five)';if(kind==='dm')return 'The DM runner';const a=byId(hero);return a?a.name:'Hero '+hero}

function renderBar(){const box=$('ralert');if(!box)return;
  if(!alerts.length&&!msg){box.hidden=true;box.replaceChildren();return}
  box.hidden=false;box.className='ralert'+(alerts.length?'':' note');box.replaceChildren();
  if(!alerts.length){box.append(el('div','rl',msg));return}
  box.append(el('div','rt','RUNNER STOPPED · WORLD PAUSED'));
  for(const x of alerts)box.append(el('div','rl',x.who+': '+x.why));
  if(msg)box.append(el('div','rl dm',msg));
  const bt=el('div','rb');
  const mk=(label,act,title)=>{const b=el('button','mini',label);b.dataset.ralert=act;b.title=title;b.onclick=()=>doAct(act);return b};
  bt.append(mk('Restart runner','restart','Start the runner again with the same mind and settings, then resume'),
    mk('Resume without it','resume','Unpause; the hero stays agent-played and autopilot carries on'),
    mk('Dismiss','dismiss','Hide this bar (the world stays paused)'));
  box.append(bt)}

export async function doAct(act){
  if(act==='dismiss'){alerts=[];msg='';renderBar();return}
  if(act==='resume'){alerts=[];msg='';if(prevSpeed!=null){setSpeed(prevSpeed);prevSpeed=null}renderBar();return}
  if(act==='restart'&&!busy){busy=true;msg='Restarting…';renderBar();let bad='';
    for(const x of alerts){const r=await startRunner(x.kind,x.kind==='hero'?x.hero:undefined);if(!r.ok)bad=bad||(x.who+': '+r.error)}
    busy=false;
    if(bad){msg=bad;renderBar();return}
    alerts=[];msg='';if(prevSpeed!=null){setSpeed(prevSpeed);prevSpeed=null}renderBar()}}

function raise(evs){
  for(const e of evs){if(!alerts.some(x=>x.key===e.key))alerts.push(e);recent[e.key]=Date.now()}
  if(prevSpeed==null&&ctl.speed>0)prevSpeed=ctl.speed;
  setSpeed(0);msg='';renderBar();alertCue()}

function note(text){msg=text;noteT=Date.now();if(!alerts.length)renderBar()}

// Call every frame; checks at most once a second.
export function checkRunAlerts(){
  if(msg&&!alerts.length&&Date.now()-noteT>6000){msg='';renderBar()}
  if(Date.now()-checkAt<1000)return;checkAt=Date.now();
  const members=(S.fellowship&&S.agents.filter(a=>a.fellow&&a.player))||[],dm=dmSeatOn();
  if(members.length||dm)watchRunners();
  const evs=[],seen=new Set();
  for(const r of allRunners()){seen.add(r.key);const p=prevState[r.key];prevState[r.key]=r.state;
    if(!p||!UP[p]||!DONE_STATE[r.state])continue;
    const a=r.kind==='hero'?byId(r.hero):null;
    if(r.kind==='hero'&&!isMember(a))continue;           // background heroes' runners never pause the world
    if(r.kind==='fellowship'&&!S.fellowship)continue;
    if(r.kind==='dm'&&!dm)continue;
    if(r.kind==='hero'&&a&&!a.player&&a.state!=='dead')continue; // the hero left agent play: not a runner failure
    if(userStopped(r.key)){note(whoOf(r.kind,r.hero)+' stopped by you.');continue}
    evs.push({key:r.key,kind:r.kind,hero:r.hero,who:whoOf(r.kind,r.hero),why:reasonOf(r,a)})}
  // link drops: a member still agent-played whose runner is gone
  if(bridgeStatus()==='connected'){
    for(const a of members){const k=agentLink(a),p=prevLink[a.id];prevLink[a.id]=k;
      if((p==='connected'||p==='waiting')&&k==='none'&&!userStopped('hero:'+a.id)&&!userStopped('fellowship')&&!(recent['hero:'+a.id]>Date.now()-30000)&&!(recent.fellowship>Date.now()-30000))
        evs.push({key:'hero:'+a.id,kind:'hero',hero:a.id,who:a.name,why:'no runner is calling tools for this hero any more'})}
    if(dm){const k=dmLink(),p=prevLink.dm;prevLink.dm=k;
      if((p==='connected'||p==='waiting')&&k==='none'&&!userStopped('dm')&&!(recent.dm>Date.now()-30000))evs.push({key:'dm',kind:'dm',who:'The DM runner',why:'no DM runner is attached any more'})}}
  // one Fellowship runner stopping covers all five
  let out=evs;if(evs.some(e=>e.kind==='fellowship'))out=evs.filter(e=>e.kind!=='hero'||!isMember(byId(e.hero)));
  if(out.length&&on)raise(out)}

export function initRunAlert(){
  const b=$('vRal');if(b){b.onclick=()=>{on=!on;try{localStorage.setItem(KEY,on?'on':'off')}catch(_){}sync()}}
  sync()}
export function sync(){const b=$('vRal');if(!b)return;b.hidden=!S.fellowship&&!dmSeatOn();b.textContent='Alert on runner stop: '+(on?'on':'off');b.setAttribute('aria-pressed',String(on))}
