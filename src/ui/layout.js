// Fellowship-first layout (issue #94). Without a Fellowship the page is exactly as index.html
// lays it out. When one exists: the party frames sit above the map, the side column opens with
// the Fellowship panel, the Chronicle (on its Fellowship filter) and Minds at play, and every
// world panel (factions, top heroes, guilds, graveyard, timeline, legends, DM log, auction house)
// moves into one collapsed "World" group below them, one click away.
// Panels are moved, never rebuilt, so their listeners and open/closed state survive the switch.
// The world panels carry data-world="<order>" in index.html; the side-column order without a
// Fellowship is data-o on every section.
//
// The dock (#546, the owner watches at 3440x1440): from DOCK (2560) CSS px with a company, the map column takes about 70%
// of the width (frames, map, bar; the map fills the height) and the side column becomes one dock with four tabs:
// Company (the Companies panel, Minds at play in Developer mode), Hero (the dossier), Story (Chronicle, Campaign log and
// the folded World group, or the loose world panels of a world without a Fellowship) and Chat. Only the open tab's
// sections show (class doff on the others: their own modules set hidden); the tab is remembered per viewer
// (eldmoor.dock). showDock(t) opens a tab (a click on a hero opens Hero).
import {S} from '../sim/index.js';
import {companies} from '../sim/company.js';
import {syncDevBtn} from './mindctl.js';
import {mountConditions,renderConditions} from './conditions.js'; // region conditions, a world panel (#366)

const $=id=>document.getElementById(id);
let mode=null;

// Three columns from 2200 CSS px (owner request): Story and the World group move to the left column,
// the hero card to the right column under the Fellowship panel. Moved, never rebuilt; below 2200 they go back.
export const WIDE3=2200,DOCK=2560;
let cols=0; // 0 not placed yet, 1, 2, 3 or 'dock'
export const columnCount=()=>{const w=window.innerWidth||0;return w>=WIDE3?3:w>920?2:1};
const hasCompany=()=>!!S.fellowship||companies().length>0;
export const dockWanted=()=>(window.innerWidth||0)>=DOCK&&hasCompany();
export const docked=()=>cols==='dock';
// Chat: left column (default) or under the map on the wide layout; remembered, never fatal.
const CKEY='eldmoor.chatLeft';let chatLeft=true;try{chatLeft=localStorage.getItem(CKEY)!=='0'}catch(e){}
export const chatInLeft=()=>chatLeft;
// The dock's tabs: [key, label, sections in order]. A missing section is skipped; any other section in the dock is Story's.
export const DOCK_TABS=[['company','Company',['fellowship','mindsSec']],['hero','Hero',['heroSec']],['story','Story',['storySec','worldgrp']],['chat','Chat',['chatSec']]];
const TAB_OF={};for(const [k,,ids] of DOCK_TABS)for(const id of ids)TAB_OF[id]=k;
const DKEY='eldmoor.dock';let dtab='company';try{const v=localStorage.getItem(DKEY);if(DOCK_TABS.some(t=>t[0]===v))dtab=v}catch(e){}
export const dockTab=()=>dtab;
// move a node and put the scroll positions of its lists back (a move resets scrollTop)
function moveKeep(n,to,first){if(!n||n.parentNode===to&&(!first||to.children[0]===n))return;
  const ls=['chatList','dmChatList','dmTurnList'].map($).filter(Boolean).map(u=>[u,u.scrollTop]);
  if(first)to.insertBefore(n,to.children[0]||null);else to.append(n);
  for(const [u,t] of ls)u.scrollTop=t}
function chatBtn(){let b=$('chatSide');const tabs=$('chatTabs');if(!tabs)return;
  if(!b){b=document.createElement('button');b.id='chatSide';b.className='chatsidebtn';
    b.addEventListener('click',()=>{chatLeft=!chatLeft;try{localStorage.setItem(CKEY,chatLeft?'1':'0')}catch(e){}placeColumns()});tabs.append(b)}
  b.hidden=cols!==3;b.textContent=chatLeft?'Under map':'Left';b.title=chatLeft?'Move the chat under the map (remembered)':'Move the chat to the left column (remembered)';b.setAttribute('aria-pressed',String(!chatLeft))}
function restoreColumns(){if(cols==='dock')undock();if(cols!==3){cols=0;return}
  const side=$('side'),colM=$('colM'),mi=$('mindsSec');cols=0;
  moveKeep($('chatSec'),colM);colM.append($('heroSec'));side.insertBefore($('storySec'),mi||null);side.append($('worldgrp'))}
function placeChat(){const L=cols===3&&chatLeft;if(cols!=='dock')moveKeep($('chatSec'),L?$('colL'):$('colM'),L);
  if(!L&&cols===3){const colM=$('colM'),c=$('chatSec');if(c&&c.parentNode!==colM)colM.append(c)}
  document.body.classList.toggle('chat-left',L);chatBtn()}

// ---- the dock (#546) ----
let bar=null;
const TAB_TIP={company:'The followed company: standing, open threads, hall board, camp, members and their runners',hero:'The selected hero: header, then Character, Story and Mind',
  story:'The Chronicle and the Campaign log, then the world panels',chat:'What the companies said, and the DM agent'};
function dockBar(){if(bar)return bar;bar=document.createElement('div');bar.id='dockTabs';bar.className='docktabs';bar.setAttribute('role','tablist');bar.setAttribute('aria-label','Dock');
  for(const [k,label] of DOCK_TABS){const b=document.createElement('button');b.textContent=label;b.dataset.dock=k;b.setAttribute('role','tab');b.id='dock-'+k;b.title=TAB_TIP[k];
    b.addEventListener('click',()=>showDock(k));bar.append(b)}
  // arrow keys move along the tabs
  bar.addEventListener('keydown',e=>{if(e.key!=='ArrowRight'&&e.key!=='ArrowLeft')return;const bs=[...bar.children],i=bs.indexOf(e.target);if(i<0)return;
    const n=bs[(i+(e.key==='ArrowRight'?1:bs.length-1))%bs.length];e.preventDefault();n.click();if(n.focus)n.focus()});
  bar.hidden=true;return bar}
// Show one tab's sections; the others get .doff.
function syncDock(){if(cols!=='dock')return;const side=$('side');
  for(const n of side.children){if(n===bar||String(n.tagName).toUpperCase()!=='SECTION')continue;n.classList.toggle('doff',(TAB_OF[n.id]||'story')!==dtab)}
  if(bar)for(const b of bar.children){const on=b.dataset.dock===dtab;b.setAttribute('aria-selected',String(on));b.setAttribute('aria-pressed',String(on));b.tabIndex=on?0:-1}
  const box=$('chatbox');if(box&&dtab==='chat'&&!box.open)box.open=true}
export function showDock(t){if(!DOCK_TABS.some(x=>x[0]===t))return;dtab=t;try{localStorage.setItem(DKEY,t)}catch(e){}syncDock()}
function dock(){const side=$('side'),colL=$('colL'),main=side.parentNode;cols='dock';
  main.classList.remove('cols3');main.classList.add('dock');colL.hidden=true;document.body.classList.add('docked');
  side.insertBefore(dockBar(),side.children[0]||null);bar.hidden=false;
  for(const [,,ids] of DOCK_TABS)for(const id of ids){const n=$(id);if(n)moveKeep(n,side)}
  // the Intent icons switch joins the View bar while the dock leaves it room (its Settings row hides while empty)
  const vi=$('vIcons'),zo=$('zOut');if(vi&&zo&&zo.parentNode){if(!vi._home)vi._home=vi.parentNode;zo.parentNode.insertBefore(vi,zo)}
  syncDock()}
function undock(){const side=$('side'),colM=$('colM'),main=side.parentNode;cols=0;
  main.classList.remove('dock');document.body.classList.remove('docked');if(bar)bar.hidden=true;
  for(const n of side.children)if(n.classList)n.classList.remove('doff');
  const vi=$('vIcons');if(vi&&vi._home&&vi.parentNode!==vi._home)vi._home.insertBefore(vi,vi._home.children[0]||null);
  // back to the plain order: the Companies panel first, then Story, Minds at play and the World group in the side
  // column; the chat and the hero card go back under the map
  moveKeep($('chatSec'),colM);colM.append($('heroSec'));
  const all=[...side.querySelectorAll(':scope > section[data-o]')].sort((x,y)=>+x.dataset.o - +y.dataset.o);for(const s of all)side.append(s);side.append($('worldgrp'))}

function placeColumns(){const want=dockWanted()?'dock':(S.fellowship&&columnCount()===3)?3:(columnCount()===1?1:2);if(want===cols){placeChat();syncDock();return}
  const side=$('side'),colL=$('colL'),main=side&&side.parentNode;if(!side||!colL||!main||!$('colM'))return;
  restoreColumns();
  if(want==='dock'){dock();placeChat();return}
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
