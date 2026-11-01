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

const $=id=>document.getElementById(id);
let mode=null;

export function applyLayout(){const fel=!!S.fellowship;if(fel===mode)return;mode=fel;
  const side=$('side'),grp=$('worldgrp'),wb=$('worldbody');if(!side||!grp||!wb)return;
  document.body.classList.toggle('fellow-mode',fel);
  if(fel){const ws=[...side.querySelectorAll(':scope > section[data-world]')].sort((x,y)=>+x.dataset.world - +y.dataset.world);for(const s of ws)wb.append(s);grp.hidden=false;side.append(grp)}
  else{const ws=[...wb.children];for(const s of ws)side.append(s);grp.hidden=true;
    const all=[...side.querySelectorAll(':scope > section[data-o]')].sort((x,y)=>+x.dataset.o - +y.dataset.o);for(const s of all)side.append(s);side.append(grp)}
  syncDevBtn()}

export const layoutMode=()=>mode;
