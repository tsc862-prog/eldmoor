// Timeline panel (issue #16): world events from S.timeline, newest first, with day and
// clock stamps, a CSS badge per kind and a filter row. Rebuilds only when the entry count
// or the filter changes. Hero names are clickable spans (.hn[data-hid]); panels.js owns
// the delegated click handler. Cheap: one pass over at most 200 entries.
import {S} from '../sim/index.js';
import {patch,keyOf} from './stable.js'; // update in place, keep scroll (#145)
import {LAIR,CRYPT,CRYPTS} from '../world/map.js';
import {styled} from '../sim/epithet.js'; // a name given for a deed (bestow, #638)
import {downTimeline,DOWN_BADGE} from './downview.js'; // downings, stabilizes and revivals from the heroes' Logs (#659)

const $=id=>document.getElementById(id);
const el=(tag,cls,text)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(text!=null)d.textContent=text;return d};

// Filters by kind. Hero-facing events, boss and raid events, deaths.
// Downed (#659): downings, stabilizes, revivals (and, with #657, mercies and finishes) read from the heroes' Logs, and deaths.
export const FILTERS=[['all','All',null],['heroes','Heroes',['level','oath','swore','crypt','elite','title','site']],['bosses','Bosses',['boss','raid']],['downs','Downed',['down','stable','up','mercy','finish','death']],['deaths','Deaths',['death']]];
const BADGE={boss:'BOSS',raid:'RAID',crypt:'CRYPT',site:'SITE',level:'LVL',death:'DEATH',elite:'ELITE',oath:'OATH',swore:'OATH',rival:'RIVAL',guild:'GUILD',title:'TITLE',...DOWN_BADGE};
let filter='all',seen=-1,seenTop=null,box=null,list=null;

export const dayOf=e=>Math.floor((e.gameMin||0)/1440)+1;
export const timelineFilter=()=>filter;
export function setTimelineFilter(f){if(FILTERS.some(([k])=>k===f)){filter=f;seen=-1;renderTimeline()}}
const matches=e=>{const f=FILTERS.find(([k])=>k===filter);return !f[2]||f[2].includes(e.kind)};

function partsTo(node,ps){for(const p of ps){if(typeof p==='string')node.append(p);
  else if(p&&p.kind==='hero'){const s=el('span','hn f'+p.fac,styled(p));s.dataset.hid=p.id;node.append(s)}
  else if(p)node.append(el('span',p.c||'',p.t))}}

export function renderTimeline(){if(!list)return;
  const tl=merged(),top=tl[0]&&(tl[0].src||tl[0]);
  if(tl.length===seen&&top===seenTop)return;
  if(!patch(list,l=>fill(l,tl)))return; // held while the viewer scrolls or selects: next second
  seen=tl.length;seenTop=top}
// The world's timeline with the downed lines folded in by game time, newest first (both lists are newest first).
function merged(){const tl=S.timeline||[],dn=downTimeline();if(!dn.length)return tl;const out=[];let i=0,j=0;
  while(i<tl.length||j<dn.length){if(j>=dn.length||(i<tl.length&&(tl[i].gameMin||0)>=dn[j].gameMin))out.push(tl[i++]);else out.push(dn[j++])}
  return out}
function fill(list,tl){
  let n=0;
  for(const e of tl){if(!matches(e))continue;
    const li=el('li','tl tl-'+e.kind);li.setAttribute('data-k',keyOf(e.src||e));
    li.append(el('time',null,'D'+dayOf(e)+' '+e.t),el('span','badge b-'+e.kind,BADGE[e.kind]||e.kind.toUpperCase()));
    const t=el('span','tx');partsTo(t,e.parts);li.append(t);
    const inside=e.site!=null?'site:'+e.site:(e.kind==='raid'||e.kind==='boss')&&LAIR?LAIR.name:e.kind==='crypt'&&CRYPT?(CRYPTS.find(D=>(e.parts||[]).some(p=>p&&p.t===D.name))||CRYPT).name:null; // Inside: the raid arena or the dungeon view (#85); a DM-made site's entry carries its id (#642)
    if(inside){const b=el('button','dglink','Inside ▸');b.type='button';b.dataset.dungeon=inside;b.title=e.kind==='crypt'?'Open the dungeon view':'Open the raid arena';li.append(' ',b)}
    list.append(li);n++}
  if(!n)list.append(el('li','dm','Nothing of note yet.'))}

export function initTimeline(){box=$('timeline');list=$('tlist');if(!box||!list)return;
  const bar=$('tfilter');
  if(bar){bar.replaceChildren();for(const [k,label] of FILTERS){const b=el('button',null,label);b.dataset.tl=k;b.setAttribute('aria-pressed',String(k===filter));
    b.addEventListener('click',()=>{setTimelineFilter(k);for(const x of bar.children)x.setAttribute('aria-pressed',String(x.dataset.tl===k))});bar.append(b)}}
  renderTimeline()} // refreshed each second by ui/app.js
