// Legends hall panel (issue #17): the ranked list from S.legends (sim/legends.js). A star
// marks Fellowship members, a marker shows living or fallen, names are clickable .hn spans
// while the hero is still in S.agents (panels.js owns the delegated click) and plain text
// once the grave is recycled. The hover line carries highlights. Rebuilds only on change.
import {S} from '../sim/index.js';

const $=id=>document.getElementById(id);
const el=(tag,cls,text)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(text!=null)d.textContent=text;return d};
let list=null,sig='';

export function renderLegends(){if(!list)return;
  const L=(S.legends&&S.legends.list)||[];
  const key=L.map(e=>e.id+':'+e.score+':'+e.alive+':'+(S.agents.some(a=>a.id===e.id)?1:0)).join('|');
  if(key===sig)return;sig=key;
  list.replaceChildren();
  if(!L.length){list.append(el('li','dm','No legends yet. Give the heroes time.'));return}
  L.forEach((e,i)=>{
    const li=el('li','lg'+(e.alive?'':' lgd'));
    const tip=(e.hl&&e.hl.length?e.hl.join(', '):'No deeds recorded yet')+(e.alive?'':'. Fell '+(e.diedAt?'at '+e.diedAt+' ':'')+'in '+(e.place||'the wilds')+' ('+e.cause+')');
    li.title=tip;
    li.append(el('span','lgr',String(i+1)),el('span',e.alive?'lgm lgl':'lgm lgx',e.alive?'●':'†'));
    if(e.fel)li.append(el('span','gd','★'));
    const live=S.agents.some(a=>a.id===e.id);
    const nm=el('span',live?'hn f'+e.fac:'f'+e.fac,e.name);if(live)nm.dataset.hid=e.id;
    li.append(nm,el('span','dm',' '+(e.tag?'<'+e.tag+'> ':'')+e.people+' '+e.cls+' Lv '+e.lvl),el('span','lgs',String(e.score)));
    li.append(el('div','meta',e.alive?(e.hl&&e.hl[0]||''):'Fell in '+(e.place||'the wilds')+', '+e.cause));
    list.append(li)})}

export function initLegends(){list=$('legends');if(!list)return;renderLegends();setInterval(renderLegends,1000)}
