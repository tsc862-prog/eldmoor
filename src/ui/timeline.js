// Timeline panel (issue #16): world events from S.timeline, newest first, with day and
// clock stamps, a CSS badge per kind and a filter row. Rebuilds only when the entry count
// or the filter changes. Hero names are clickable spans (.hn[data-hid]); panels.js owns
// the delegated click handler. Cheap: one pass over at most 200 entries.
import {S} from '../sim/index.js';
import {patch,keyOf} from './stable.js'; // update in place, keep scroll (#145)

const $=id=>document.getElementById(id);
const el=(tag,cls,text)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(text!=null)d.textContent=text;return d};

// Filters by kind. Hero-facing events, boss and raid events, deaths.
export const FILTERS=[['all','All',null],['heroes','Heroes',['level','oath','crypt','elite']],['bosses','Bosses',['boss','raid']],['deaths','Deaths',['death']]];
const BADGE={boss:'BOSS',raid:'RAID',crypt:'CRYPT',level:'LVL',death:'DEATH',elite:'ELITE',oath:'OATH',rival:'RIVAL',guild:'GUILD'};
let filter='all',seen=-1,seenTop=null,box=null,list=null;

export const dayOf=e=>Math.floor((e.gameMin||0)/1440)+1;
export const timelineFilter=()=>filter;
export function setTimelineFilter(f){if(FILTERS.some(([k])=>k===f)){filter=f;seen=-1;renderTimeline()}}
const matches=e=>{const f=FILTERS.find(([k])=>k===filter);return !f[2]||f[2].includes(e.kind)};

function partsTo(node,ps){for(const p of ps){if(typeof p==='string')node.append(p);
  else if(p&&p.kind==='hero'){const s=el('span','hn f'+p.fac,p.name);s.dataset.hid=p.id;node.append(s)}
  else if(p)node.append(el('span',p.c||'',p.t))}}

export function renderTimeline(){if(!list)return;
  const tl=S.timeline||[];
  if(tl.length===seen&&tl[0]===seenTop)return;
  if(!patch(list,l=>fill(l,tl)))return; // held while the viewer scrolls or selects: next second
  seen=tl.length;seenTop=tl[0]}
function fill(list,tl){
  let n=0;
  for(const e of tl){if(!matches(e))continue;
    const li=el('li','tl tl-'+e.kind);li.setAttribute('data-k',keyOf(e));
    li.append(el('time',null,'D'+dayOf(e)+' '+e.t),el('span','badge b-'+e.kind,BADGE[e.kind]||e.kind.toUpperCase()));
    const t=el('span','tx');partsTo(t,e.parts);li.append(t);list.append(li);n++}
  if(!n)list.append(el('li','dm','Nothing of note yet.'))}

export function initTimeline(){box=$('timeline');list=$('tlist');if(!box||!list)return;
  const bar=$('tfilter');
  if(bar){bar.replaceChildren();for(const [k,label] of FILTERS){const b=el('button',null,label);b.dataset.tl=k;b.setAttribute('aria-pressed',String(k===filter));
    b.addEventListener('click',()=>{setTimelineFilter(k);for(const x of bar.children)x.setAttribute('aria-pressed',String(x.dataset.tl===k))});bar.append(b)}}
  renderTimeline()} // refreshed each second by ui/app.js
