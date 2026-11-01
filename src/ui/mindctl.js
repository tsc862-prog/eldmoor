// Per-member mind control (issue #94): who plays one hero right now (the scripted rules, a model
// via the relay, or an agent runner) and a button that cycles it. Used by the party frames and
// the Fellowship roster. When a Fellowship exists only its members need AI or Agent control; the
// hero card hides those buttons on everyone else unless the small "Developer" toggle is on.
import {S,enableBrain,disableBrain,brainStatus} from '../sim/index.js';
import {agentOn,agentOff,agentLink,LINK_TEXT} from './player-bridge.js';

const el=(tag,cls,text)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(text!=null)d.textContent=text;return d};

// 'agent' | 'ai' | 'quiet' (AI-played, relay silent) | 'scripted'
export const mindOf=a=>!a?'scripted':a.player?'agent':a.brain?(brainStatus(a)==='offline'?'quiet':'ai'):'scripted';
export const MIND_LABEL={scripted:'SCRIPTED',ai:'AI',quiet:'AI · QUIET',agent:'AGENT'};
// Short text for the mind tag, with the agent runner's link state when agent-played.
export function mindText(a){const m=mindOf(a);if(m!=='agent')return MIND_LABEL[m];const k=agentLink(a);
  return 'AGENT · '+(k==='connected'?'LIVE':k==='waiting'?'IDLE':k==='none'?'NO RUNNER':String(k).toUpperCase())}
export function mindTitle(a){const m=mindOf(a);
  return m==='agent'?'Agent-played: '+(LINK_TEXT[agentLink(a)]||agentLink(a))+'. Runner: npm run agent -- --hero '+a.name
    :m==='ai'?'A language model plays this hero through the relay (npm run relay).'
    :m==='quiet'?'AI-played, but the relay is not answering; the scripted rules play for now.':'The scripted rules play this hero.'}
const NEXT={scripted:'AI',ai:'Agent',quiet:'Agent',agent:'Scripted'};

// Scripted -> AI -> Agent -> Scripted. A member's mind set here is marked the way the Fellowship's
// Minds switch marks it (fellowBrain / fellowAgent), so leaving the Fellowship hands the hero back.
export function cycleMind(a){if(!a||a.state==='dead')return;const m=mindOf(a);
  if(m==='agent'){agentOff(a);delete a.fellowAgent}
  else if(m==='ai'||m==='quiet'){disableBrain(a);delete a.fellowBrain;if(agentOn(a)&&a.fellow)a.fellowAgent=true}
  else if(enableBrain(a)&&a.fellow)a.fellowBrain=true}

// The control: a small button naming the next mind; data-mindctl carries the hero id.
export function mindButton(a){const m=mindOf(a),b=el('button','mini mindbtn','→ '+NEXT[m]);b.dataset.mindctl=a.id;
  b.title='Mind: '+MIND_LABEL[m].toLowerCase()+'. Click to switch to '+NEXT[m].toLowerCase()+' (scripted → AI → agent).';return b}

// ---- the Developer toggle (kept per viewer) ----
const KEY='eldmoor.dev';
let dev=false;try{dev=localStorage.getItem(KEY)==='1'}catch(_){}
export const devMode=()=>dev;
// AI/Agent buttons on the hero card: for everyone without a Fellowship, for members with one,
// and for everyone again in Developer mode.
export const showMindButtons=a=>!S.fellowship||!!(a&&a.fellow)||dev;

let after=()=>{};
// One delegated click (capture phase) for every [data-mindctl] button; onChange re-renders.
export function initMindCtl(onChange){after=onChange||(()=>{});
  document.addEventListener('click',e=>{const t=e.target&&e.target.closest?e.target.closest('[data-mindctl]'):null;if(!t)return;
    e.stopPropagation();const a=S.agents.find(x=>x.id==t.dataset.mindctl);if(a){cycleMind(a);after()}},true);
  const d=document.getElementById('wDev');if(d){d.setAttribute('aria-pressed',String(dev));
    d.onclick=()=>{dev=!dev;try{localStorage.setItem(KEY,dev?'1':'0')}catch(_){}d.setAttribute('aria-pressed',String(dev));after()}}
  syncDevBtn()}
export function syncDevBtn(){const d=document.getElementById('wDev');if(d)d.hidden=!S.fellowship}
