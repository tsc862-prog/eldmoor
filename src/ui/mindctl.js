// Per-member mind control (issue #94): who plays one hero right now (the scripted rules, a model
// via the relay, or an agent runner) and a button that cycles it. Used by the party frames and
// the Fellowship roster. A Fellowship member is always agent-played (#148): it gets no cycle button
// and no AI/Agent toggles, only its mind label (its model is picked on its runner, ui/mindpick.js).
// Background heroes keep Scripted / AI / Agent, on the hero card only while the "Developer" toggle is
// on when a Fellowship exists.
import {S,enableBrain,disableBrain,brainStatus} from '../sim/index.js';
import {agentOn,agentOff} from './player-bridge.js';
import {mindLabel} from './mindlabel.js';
import {inSlots,slotted} from '../sim/company.js'; // the slotted company (#588)

const el=(tag,cls,text)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(text!=null)d.textContent=text;return d};

// 'agent' | 'ai' | 'quiet' (AI-played, relay silent) | 'scripted'
export const mindOf=a=>!a?'scripted':a.player?'agent':a.brain?(brainStatus(a)==='offline'?'quiet':'ai'):'scripted';
export const MIND_LABEL={scripted:'Scripted',ai:'AI',quiet:'AI',agent:'Agent'};
// The one mind label (ui/mindlabel.js): Scripted, AI (model) or Agent (runner model · link).
export const mindText=a=>mindLabel(a).text;
export const mindTitle=a=>mindLabel(a).title;
const NEXT={scripted:'AI',ai:'Agent',quiet:'Agent',agent:'Scripted'};

// Scripted -> AI -> Agent -> Scripted. A member's mind set here is marked the way the Fellowship's
// Minds switch marks it (fellowBrain / fellowAgent), so leaving the Fellowship hands the hero back.
export function cycleMind(a){if(!a||a.state==='dead'||inSlots(a))return;const m=mindOf(a); // a member stays an agent (#148)
  if(m==='agent'){agentOff(a);delete a.fellowAgent}
  else if(m==='ai'||m==='quiet'){disableBrain(a);delete a.fellowBrain;if(agentOn(a)&&inSlots(a))a.fellowAgent=true}
  else if(enableBrain(a)&&inSlots(a))a.fellowBrain=true}

// The control: a small button naming the next mind; data-mindctl carries the hero id.
export function mindButton(a){if(a&&inSlots(a)){const s=el('span','mini mindbtn','Agent');s.title='Mind: '+mindText(a)+'. A Fellowship member is always played by its agent; pick the model on its runner (Fellowship panel).';return s}
  const m=mindOf(a),b=el('button','mini mindbtn','→ '+NEXT[m]);b.dataset.mindctl=a.id;
  b.title='Mind: '+mindText(a)+'. Click to switch to '+NEXT[m].toLowerCase()+' (scripted → AI → agent).';return b}

// ---- the Developer toggle (kept per viewer) ----
const KEY='eldmoor.dev';
let dev=false;try{dev=localStorage.getItem(KEY)==='1'}catch(_){}
export const devMode=()=>dev;
// AI/Agent buttons on the hero card: never on a Fellowship member (always an agent, #148); on everyone
// else without a Fellowship, or in Developer mode.
export const showMindButtons=a=>!(a&&inSlots(a))&&(!slotted()||dev);

let after=()=>{};
// One delegated click (capture phase) for every [data-mindctl] button; onChange re-renders.
export function initMindCtl(onChange){after=onChange||(()=>{});
  document.addEventListener('click',e=>{const t=e.target&&e.target.closest?e.target.closest('[data-mindctl]'):null;if(!t)return;
    e.stopPropagation();const a=S.agents.find(x=>x.id==t.dataset.mindctl);if(a){cycleMind(a);after()}},true);
  const d=document.getElementById('wDev');if(d){d.setAttribute('aria-pressed',String(dev));
    d.onclick=()=>{dev=!dev;try{localStorage.setItem(KEY,dev?'1':'0')}catch(_){}d.setAttribute('aria-pressed',String(dev));syncDevBody();after()}}
  syncDevBody()
  syncDevBtn()}
// body.dev-mode shows the developer surfaces (Minds at play with a Fellowship, request stats; #145)
function syncDevBody(){if(document.body&&document.body.classList)document.body.classList.toggle('dev-mode',dev)}
export function syncDevBtn(){const d=document.getElementById('wDev');if(d)d.hidden=!slotted()}
