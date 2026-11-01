// Table mode banner and switch (issue #68, phase B). Reads sim/table.js only.
//   banner  over the map while the Fellowship is at a scene: the scene, the DM's framing (with
//           the dice when it is a check), initiative order with the current turn marked, whose
//           turn it is ("Pellora is thinking… (5 s)") and the last act, then the outcome
//   switch  the View group's "Table: Auto / Off" button (Off = Watch mode, never pauses); kept
//           per viewer in localStorage
import {TABLE,bannerOf} from '../sim/table.js';
import {S} from '../sim/index.js';

const $=id=>document.getElementById(id);
const el=(tag,cls,text)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(text!=null)d.textContent=text;return d};
const plain=ps=>(ps||[]).map(p=>typeof p==='string'?p:p&&p.kind==='hero'?p.name:p&&p.t||'').join('');
const KEY='eldmoor.tableMode';
let sig='';

function syncBtn(){const b=$('vTab');if(!b)return;b.hidden=!S.fellowship;b.textContent='Table: '+(TABLE.mode==='off'?'Off':'Auto');b.setAttribute('aria-pressed',String(TABLE.mode!=='off'))}
export function initTable(){
  try{const v=localStorage.getItem(KEY);if(v==='off'||v==='auto')TABLE.mode=v}catch(_){}
  const b=$('vTab');if(b)b.onclick=()=>{TABLE.mode=TABLE.mode==='off'?'auto':'off';try{localStorage.setItem(KEY,TABLE.mode)}catch(_){}syncBtn()};
  syncBtn()}

// Called every frame with the host's speed: the sim pauses only at 1x.
export function renderTable(speed){TABLE.speed=speed>0?speed:1;syncBtn();const box=$('tbanner');if(!box)return;
  const b=bannerOf();if(!b){if(!box.hidden){box.hidden=true;sig=''}return}
  const s=[b.title,b.phase,b.line,b.last,b.turn,b.paused,b.narr].join('|');if(s===sig)return;sig=s;box.hidden=false;box.replaceChildren();
  const tt=el('div','tt','AT THE TABLE · '+b.title.toUpperCase());if(b.paused)tt.append(el('span','tp','WORLD PAUSED'));box.append(tt);
  box.append(el('div','tf',plain(b.frame)));
  if(b.narr)box.append(el('div','tf tnarr',b.narr)); // the DM's narrate line (issue #123)
  const o=el('div','to');b.order.forEach((a,i)=>{if(i)o.append(' · ');o.append(i===b.turn?el('b',null,'▶ '+a.name):a.name)});box.append(o);
  box.append(el('div','tl',b.line));if(b.last&&b.phase!=='outcome')box.append(el('div','to',b.last))}
