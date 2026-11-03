// The gambit hold bar (issue #630): while a hero's rule holds the world (sim/gambithold.js) a bar over the map reads
// "HELD FOR <name> · <rule>" with the seconds left and Resume anyway (the owner's override, as for the start gate).
import {S,holdResume} from '../sim/index.js';
import {GAMBIT} from '../data/gambits.js';

let box=null,sig='';
function make(){const t=document.getElementById('tbanner');if(!t||!t.parentNode)return null;
  const b=document.createElement('div');b.className='tbanner';b.id='holdbar';b.hidden=true;b.setAttribute('aria-live','polite');
  b.style.cssText='top:auto;bottom:8px;pointer-events:auto;border-color:#ffd866';
  t.parentNode.insertBefore(b,t.nextSibling);return b}
export function renderHold(){const h=S.gambitHold;
  if(!box&&!(box=make()))return;
  if(!h){if(!box.hidden){box.hidden=true;sig=''}return}
  const left=Math.max(0,Math.ceil(GAMBIT.HOLD_MAX_S-h.s)),s=h.id+'|'+h.rule+'|'+left;if(s===sig)return;sig=s;box.hidden=false;box.textContent='';
  const t=document.createElement('div');t.className='tt';t.textContent='HELD FOR '+h.name.toUpperCase()+' · '+h.rule+' · '+left+' S';box.append(t);
  const bt=document.createElement('button');bt.type='button';bt.textContent='Resume anyway';bt.addEventListener('click',()=>{holdResume();sig=''});box.append(bt)}
