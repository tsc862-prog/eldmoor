// The DM seat (issue #66, #560), page side: pick the DM agent's mind (Claude or a local Ollama model), Start / Stop /
// Restart DM through the relay's runner supervisor, and the seat's link (connected / waiting / no runner), runner
// state with spend against its budget, and the notes count. Shown in the Dungeon Master panel's header (#dmseat) and as
// the DM row of the Minds at play panel (dmMindRow). The DM is always an agent (#520): no Open/Close seat.
//   renderDmSeat()  rebuilds #dmseat when what it shows changed
//   dmMindRow()     the Minds panel row (an <li>), or null when the seat is closed and no runner is up
//   dmSeatSig()     what both show, for the callers' rebuild signatures
import {S,dmSeatOn,dmAgentView} from '../sim/index.js';
import {dmLink,dmRunnerTag,LINK_TEXT,bridgeStatus} from './player-bridge.js';
import {dmRunnerControl,dmRunnerSig,runnerPick,runnerByKey} from './runners.js';
import {pulledModels} from './mindpick.js';
import {patch} from './stable.js'; // update in place (#145)

const el=(tag,cls,text)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(text!=null)d.textContent=text;return d};
const DONE={stopped:1,crashed:1};
let box=null,last='';
const live=()=>{const r=runnerByKey('dm');return !!(r&&!DONE[r.state])};

export const dmSeatSig=()=>{const v=dmAgentView();return [dmSeatOn(),dmLink(),dmRunnerTag(),dmRunnerSig(),pulledModels().join(','),v?v.day.pulls+':'+v.stats.calls:'',notesN()].join('|')};

// The seat's controls (#560, the DM is always an agent): [mind + budget] [Restart DM | Stop DM | Start DM] state (with the
// spend against the budget), the link and the notes count. No Open/Close seat: the page opens the seat of the world it plays.
const notesN=()=>{const D=S.dmAgent;return D&&D.notes?Object.values(D.notes).reduce((n,a)=>n+(a?a.length:0),0):0};
function controls(compact){const d=el('div','dmseat'+(compact?' compact':''));
  if(!dmSeatOn()){if(!compact)d.append(el('span','dm','The DM seat opens when a world is played.'));return d}
  if(!live())d.append(runnerPick('dm',pulledModels()));d.append(dmRunnerControl());
  const k=dmLink(),rt=dmRunnerTag(),s=el('span','mlink '+k,(k==='connected'?'DM agent connected':k==='waiting'?'DM agent waiting':k==='none'?'no DM runner':LINK_TEXT[k]||k)+(rt?' · '+rt:''));
  s.title='The DM agent link to the game (relay '+bridgeStatus()+'). Terminal alternative: npm run dm';d.append(s);
  d.append(el('span','dm dmnotes','Notes '+notesN()));
  return d}

export function renderDmSeat(){if(!box)box=document.getElementById('dmseat');if(!box)return;
  const sig=dmSeatSig();if(sig===last)return;
  if(patch(box,b=>b.append(controls(false))))last=sig} // never under an open picker (#145)

// The Minds at play row for the DM seat.
export function dmMindRow(){if(!dmSeatOn())return null;const li=el('li','mind dmmind'),top=el('div','mtop');
  top.append(el('span','gd','Dungeon Master'),el('span','mlvl',' the DM seat'),el('span','mtag agent','DM'));li.append(top,controls(true));
  const v=dmAgentView();if(v&&v.calls.length){const c=v.calls[0],d=el('div','mlast');d.append(el('span','mt',c.t+' · DM · '),el('span','mo '+(c.ok?'ok':'bad'),c.tool+(c.args?' '+c.args:'')));li.append(d)}
  return li}

export function initDmSeat(){box=document.getElementById('dmseat');renderDmSeat()} // refreshed each second by ui/app.js
