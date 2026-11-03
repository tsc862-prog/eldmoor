// Runner-stop sound and notes (owner request on #136, reworked for the run gate #171). The world no longer pauses here:
// ui/rungate.js holds it while any required seat (a living Fellowship member, the DM when its agent is chosen) has no
// runner, shows the bar with who is missing and why, and offers Start / Restart. This module keeps:
//  - the runner links told to the sim (sim/runlink.js): each member's link from the relay's claims, and whether reflexes
//    may decide for a member without a runner (only with the Developer switch "Run without agents");
//  - the distinct alert sound when the gate closes (option "Sound on runner stop", kept per viewer);
//  - a quiet note when you stop a runner yourself, and the drop to 1x at a Fellowship decision (TABLE.drop).
import {S,dmSeatOn,TABLE,setRunnerLinks,setReflexAck,setRunnerMind} from '../sim/index.js';
import {allRunners,userStopped,DONE_STATE} from './runners.js';
import {agentLink,agentRunner} from './player-bridge.js';
import {ctl} from './controls.js';
import {alertCue} from './table.js';
import {runFree,onGateClose} from './rungate.js';
export {reasonOf} from './runners.js';

const $=id=>document.getElementById(id);
const el=(tag,cls,text)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(text!=null)d.textContent=text;return d};
const KEY='eldmoor.runAlert';
let on=true;try{if(localStorage.getItem(KEY)==='off')on=false}catch(_){}
export const alertOn=()=>on;
const UP={starting:1,live:1,waiting:1};
const prevState={};
let noteT=0,msg='';
const byId=id=>S.agents.find(x=>x.id==id);

function setSpeed(v){ctl.speed=v;for(const b of document.querySelectorAll('[data-sp]'))b.setAttribute('aria-pressed',String(+b.dataset.sp===v))}
function whoOf(kind,hero){if(kind==='fellowship')return 'The Fellowship runner (all five)';if(kind==='dm')return 'The DM runner';const a=byId(hero);return a?a.name:'Hero '+hero}

function renderNote(){const box=$('ralert');if(!box)return;
  if(!msg){box.hidden=true;box.replaceChildren();return}
  box.hidden=false;box.className='ralert note';box.replaceChildren(el('div','rl',msg))}
function note(text){msg=text;noteT=Date.now();renderNote()}

// Call every frame; checks at most once a second (the speed drop at once).
let checkAt=0;
export function checkRunAlerts(){
  if(TABLE.drop){const why=TABLE.drop.reason;TABLE.drop=null;if(ctl.speed>1){setSpeed(1);note('Back to 1x: a Fellowship decision waits for its agents ('+why+').')}}
  if(msg&&Date.now()-noteT>6000){msg='';renderNote()}
  if(Date.now()-checkAt<1000)return;checkAt=Date.now();
  const dm=dmSeatOn();
  for(const r of allRunners()){const p=prevState[r.key];prevState[r.key]=r.state;
    if(!p||!UP[p]||!DONE_STATE[r.state])continue;
    if(r.kind==='hero'){const a=byId(r.hero);if(!a||!a.fellow)continue}
    if(r.kind==='fellowship'&&!S.fellowship)continue;
    if(r.kind==='dm'&&!dm)continue;
    if(userStopped(r.key))note(whoOf(r.kind,r.hero)+' stopped by you.')}}

export function initRunAlert(){
  setRunnerLinks(a=>agentLink(a));                       // the relay's claims: connected / waiting = a runner holds the hero
  setRunnerMind(a=>agentRunner(a));                      // relay writing kinds follow the hero's runner mind (#478)
  setReflexAck(()=>runFree());                           // reflexes for a runner-less member only in Developer "Run without agents"
  onGateClose(()=>{if(on)alertCue()});
  const b=$('vRal');if(b){b.onclick=()=>{on=!on;try{localStorage.setItem(KEY,on?'on':'off')}catch(_){}sync()}}
  sync()}
export function sync(){const b=$('vRal');if(!b)return;b.hidden=!S.fellowship&&!dmSeatOn();b.textContent='Alert on runner stop: '+(on?'on':'off');b.setAttribute('aria-pressed',String(on))}
