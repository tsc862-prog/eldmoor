// The whole-map legend (#844): the whole map is fit by height, so on a wide screen it leaves a bar of black each side. In
// that view the bars carry a quiet legend instead: regions with their level bands and weather on the left, the day and
// each company with where it stands on the right. Built once, rebuilt only when its text changes; the corner minimap is
// hidden meanwhile (render/draw.js). Read-only over the sim; DOM only.
import {S} from '../sim/index.js';
import {cam} from '../render/draw.js';
import {REGIONS,ZONES,zoneAt,CITY} from '../world/map.js';
import {weatherName} from '../sim/weather.js';
import {companySpots} from '../render/wholemap.js';
import {clockStr} from '../sim/state.js';

const $=id=>document.getElementById(id);
const MIN_BAR=210; // CSS px a bar needs to be worth showing
let L=null,R=null,sigL='',sigR='';
const el=(t,c,x)=>{const n=document.createElement(t);if(c)n.className=c;if(x!=null)n.textContent=x;return n};

export function initMapLegend(){const scr=$('screen');if(!scr||!scr.insertBefore)return;
  L=el('div','maplegend mlL');R=el('div','maplegend mlR');L.hidden=R.hidden=true;
  L.setAttribute('aria-label','Regions');R.setAttribute('aria-label','Companies');scr.append(L,R)}

const placeOf=s=>{const t=CITY.find(c=>s.x>=c.x0-1&&s.x<=c.x1+2&&s.y>=c.y0-1&&s.y<=c.y1+2);
  return t?t.name:ZONES[zoneAt(Math.round(s.x),Math.round(s.y))]||''};

function fill(node,rows){node.replaceChildren();for(const r of rows)node.append(r)}

export function renderMapLegend(){if(!L)return;
  const bar=cam.dpr?Math.floor((cam.offX||0)/cam.dpr):0,on=!!cam.whole&&bar>=MIN_BAR;
  L.hidden=R.hidden=!on;if(!on)return;
  const w=(bar-28)+'px';if(L.style.width!==w){L.style.width=w;R.style.width=w}
  const spots=companySpots();
  const left=[el('h3',null,'Regions')],counts=new Map();
  for(const a of S.agents||[]){if(a.hidden||a.state==='dead')continue;const z=zoneAt(Math.round(a.x),Math.round(a.y));counts.set(z,(counts.get(z)||0)+1)}
  const here=new Set(spots.map(s=>zoneAt(Math.round(s.x),Math.round(s.y))));
  REGIONS.forEach((r,i)=>{const row=el('div','mlrow'+(here.has(i)?' here':''));
    row.append(el('span','mln',r.name),el('span','mlb',r.band?'Lv '+r.band[0]+'-'+(r.band[1]===Infinity?'+':r.band[1]):''),el('span','mlw dm',weatherName(i)));left.push(row)});
  const sl=left.map(n=>n.textContent).join('|');
  if(sl!==sigL){sigL=sl;fill(L,left)}
  const right=[el('h3',null,'Day '+(Math.floor(S.gameMin/60/24)+1)+' \u00b7 '+clockStr())];
  right.push(el('div','mlsub','Companies'));
  for(const s of spots){const row=el('div','mlrow co'+(s.followed?' fol':''));
    row.append(el('span','mln',(s.followed?'\u2605 ':'')+s.name),el('span','mlb',placeOf(s)));right.push(row)}
  if(!spots.length)right.push(el('div','dm','No company on the map.'));
  const sr=right.map(n=>n.textContent).join('|');
  if(sr!==sigR){sigR=sr;fill(R,right)}}
