// The DM seat (issue #66), page side: open or close the seat, pick the DM agent's mind (Claude or a
// local Ollama model), Start DM / Stop DM through the relay's runner supervisor, and the seat's link
// (connected / waiting / no runner) and runner state (starting, live, waiting, stopped, crashed and the
// last error line). Shown in the Dungeon Master panel's header (#dmseat) and as the DM row of the Minds
// at play panel (dmMindRow). With the seat closed the scripted DM runs alone, exactly as before.
//   renderDmSeat()  rebuilds #dmseat when what it shows changed
//   dmMindRow()     the Minds panel row (an <li>), or null when the seat is closed and no runner is up
//   dmSeatSig()     what both show, for the callers' rebuild signatures
import {dmSeatOn,dmAgentView} from '../sim/index.js';
import {dmSeatSet,dmLink,dmRunnerTag,LINK_TEXT,bridgeStatus} from './player-bridge.js';
import {dmRunnerControl,dmRunnerSig,runnerPick,runnerByKey} from './runners.js';
import {pulledModels} from './mindpick.js';
import {patch} from './stable.js'; // update in place (#145)

const el=(tag,cls,text)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(text!=null)d.textContent=text;return d};
const DONE={stopped:1,crashed:1};
let box=null,last='';
const live=()=>{const r=runnerByKey('dm');return !!(r&&!DONE[r.state])};

export const dmSeatSig=()=>{const v=dmAgentView();return [dmSeatOn(),dmLink(),dmRunnerTag(),dmRunnerSig(),pulledModels().join(','),v?v.day.pulls+':'+v.stats.calls:''].join('|')};

// The seat's controls: [Open seat | Close seat] [mind] [Start DM | Stop DM] state, and the link.
function controls(compact){const d=el('div','dmseat'+(compact?' compact':'')),on=dmSeatOn();
  const b=el('button','mini',on?'Close seat':'Open seat');b.dataset.dmseat=on?'close':'open';
  b.title=on?'Close the DM seat: the agent DM stops being answered, the scripted DM runs alone (notes are kept)':'Open the DM seat so an agent DM can sit in (Start DM below, or npm run dm in a terminal)';d.append(b);
  if(on){if(!live())d.append(runnerPick('dm',pulledModels()));d.append(dmRunnerControl());
    const k=dmLink(),rt=dmRunnerTag(),s=el('span','mlink '+k,(k==='connected'?'DM agent connected':k==='waiting'?'DM agent waiting':k==='none'?'no DM runner':LINK_TEXT[k]||k)+(rt?' · '+rt:''));
    s.title='The DM agent\'s link to the game (relay '+bridgeStatus()+'). Terminal alternative: npm run dm';d.append(s)}
  else if(!compact)d.append(el('span','dm',' Scripted DM only. Open the seat to let an agent DM prepare the campaign.'));
  return d}

export function renderDmSeat(){if(!box)box=document.getElementById('dmseat');if(!box)return;
  const sig=dmSeatSig();if(sig===last)return;
  if(patch(box,b=>b.append(controls(false))))last=sig} // never under an open picker (#145)

// The Minds at play row for the DM seat.
export function dmMindRow(){if(!dmSeatOn()&&!live())return null;const li=el('li','mind dmmind'),top=el('div','mtop');
  top.append(el('span','gd','Dungeon Master'),el('span','mlvl',' the DM seat'),el('span','mtag agent','DM'));li.append(top,controls(true));
  const v=dmAgentView();if(v&&v.calls.length){const c=v.calls[0],d=el('div','mlast');d.append(el('span','mt',c.t+' · DM · '),el('span','mo '+(c.ok?'ok':'bad'),c.tool+(c.args?' '+c.args:'')));li.append(d)}
  return li}

export function initDmSeat(after){const done=after||(()=>{});box=document.getElementById('dmseat');
  document.addEventListener('click',e=>{const t=e.target&&e.target.closest?e.target.closest('[data-dmseat]'):null;if(!t)return;e.stopPropagation();
    dmSeatSet(t.dataset.dmseat==='open');last='';renderDmSeat();done()},true);
  renderDmSeat()} // refreshed each second by ui/app.js
