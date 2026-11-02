// Fellowship-first layout (issue #94). Without a Fellowship the page is exactly as index.html
// lays it out. When one exists: the party frames sit above the map, the side column opens with
// the Fellowship panel, the Chronicle (on its Fellowship filter) and Minds at play, and every
// world panel (factions, top heroes, guilds, graveyard, timeline, legends, DM log, auction house)
// moves into one collapsed "World" group below them, one click away.
// Panels are moved, never rebuilt, so their listeners and open/closed state survive the switch.
// The world panels carry data-world="<order>" in index.html; the side-column order without a
// Fellowship is data-o on every section.
import {S} from '../sim/index.js';
import {syncDevBtn} from './mindctl.js';
import {mountConditions,renderConditions} from './conditions.js'; // region conditions, a world panel (#366)

const $=id=>document.getElementById(id);
let mode=null;

// Three columns from 2200 CSS px (owner request): Story and the World group move to the left column,
// the hero card to the right column under the Fellowship panel. Moved, never rebuilt; below 2200 they go back.
export const WIDE3=2200;
let cols=0;
export const columnCount=()=>{const w=window.innerWidth||0;return w>=WIDE3?3:w>920?2:1};
// Chat: left column (default) or under the map on the wide layout; remembered, never fatal.
const CKEY='eldmoor.chatLeft';let chatLeft=true;try{chatLeft=localStorage.getItem(CKEY)!=='0'}catch(e){}
export const chatInLeft=()=>chatLeft;
// move a node and put the scroll positions of its lists back (a move resets scrollTop)
function moveKeep(n,to,first){if(!n||n.parentNode===to&&(!first||to.children[0]===n))return;
  const ls=['chatList','dmChatList','dmTurnList'].map($).filter(Boolean).map(u=>[u,u.scrollTop]);
  if(first)to.insertBefore(n,to.children[0]||null);else to.append(n);
  for(const [u,t] of ls)u.scrollTop=t}
function chatBtn(){let b=$('chatSide');const tabs=$('chatTabs');if(!tabs)return;
  if(!b){b=document.createElement('button');b.id='chatSide';b.className='chatsidebtn';
    b.addEventListener('click',()=>{chatLeft=!chatLeft;try{localStorage.setItem(CKEY,chatLeft?'1':'0')}catch(e){}placeColumns()});tabs.append(b)}
  b.hidden=cols!==3;b.textContent=chatLeft?'Under map':'Left';b.title=chatLeft?'Move the chat under the map (remembered)':'Move the chat to the left column (remembered)';b.setAttribute('aria-pressed',String(!chatLeft))}
function restoreColumns(){if(cols!==3){cols=0;return}
  const side=$('side'),colM=$('colM'),mi=$('mindsSec');cols=0;
  moveKeep($('chatSec'),colM);colM.append($('heroSec'));side.insertBefore($('storySec'),mi||null);side.append($('worldgrp'))}
function placeChat(){const L=cols===3&&chatLeft;moveKeep($('chatSec'),L?$('colL'):$('colM'),L);
  if(!L&&cols===3){const colM=$('colM'),c=$('chatSec'),h=$('heroSec');if(c&&c.parentNode!==colM)colM.append(c)}
  document.body.classList.toggle('chat-left',L);chatBtn()}
function placeColumns(){const want=(S.fellowship&&columnCount()===3)?3:(columnCount()===1?1:2);if(want===cols){placeChat();return}
  const side=$('side'),colL=$('colL'),main=side&&side.parentNode;if(!side||!colL||!main||!$('colM'))return;
  if(want!==3)restoreColumns();
  cols=want;main.classList.toggle('cols3',want===3);colL.hidden=want!==3;
  if(want===3){colL.append($('storySec'));colL.append($('worldgrp'));side.append($('heroSec'))}
  placeChat()}
let rs=0;if(typeof window!=='undefined'&&window.addEventListener)window.addEventListener('resize',()=>{clearTimeout(rs);rs=setTimeout(placeColumns,100)});
export function applyLayout(){mountConditions();renderConditions();const fel=!!S.fellowship;if(fel!==mode)restoreColumns();
  if(fel===mode){placeColumns();return}mode=fel;
  const side=$('side'),grp=$('worldgrp'),wb=$('worldbody');if(!side||!grp||!wb)return;
  document.body.classList.toggle('fellow-mode',fel);
  if(fel){const ws=[...side.querySelectorAll(':scope > section[data-world]')].sort((x,y)=>+x.dataset.world - +y.dataset.world);for(const s of ws)wb.append(s);grp.hidden=false;side.append(grp)}
  else{const ws=[...wb.children];for(const s of ws)side.append(s);grp.hidden=true;
    const all=[...side.querySelectorAll(':scope > section[data-o]')].sort((x,y)=>+x.dataset.o - +y.dataset.o);for(const s of all)side.append(s);side.append(grp)}
  placeColumns();syncDevBtn()}

export const layoutMode=()=>mode;
