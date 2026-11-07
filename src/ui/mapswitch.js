// The page's half of a map switch (#1013 slice 4). No reload, no gate, no prep: the sim changes the live map inside one step, render/roadfade.js covers the handover,
// and here the panels that were built from the map are built again: the region picker and whoever was selected, and the cinema view takes the picture back with
// director.enter. The minimap and the legend read the live bindings by themselves (render/draw.js resets the minimap's picture).
// The road bar: while a company walks to a road off the map, or stands at it held, a bar over the map says which road and what it waits on, read from
// crossingView(). At the table the Table banner says it all; the bar steps aside below it when something else has the table, and goes while that banner is docked.
import {S,crossingView} from '../sim/index.js';
import {cam,onMapArrive} from '../render/draw.js';
import {followedCompany,followedMembers} from './companyview.js';
import {select,setView,syncView,fillRegionPicker} from './controls.js';
import {cinemaArrive} from './cinema.js';
import {sceneLook} from '../render/sceneview.js';

const PHASE={walking:'On the way',go:'Setting out'};
let box=null,sig='';
function make(){const t=document.getElementById('tbanner');if(!t||!t.parentNode)return null;
  const b=document.createElement('div');b.className='tbanner';b.id='roadbar';b.hidden=true;b.setAttribute('aria-live','polite');
  t.parentNode.insertBefore(b,t.nextSibling);return b}
export function renderRoad(){if(!box&&!(box=make()))return;const v=crossingView(),on=!!v&&v.phase!=='table';
  if(!on){if(!box.hidden){box.hidden=true;sig=''}return}
  const t=document.getElementById('tbanner'),top=t&&!t.hidden?t.offsetHeight+16:8,p=box.parentNode;
  if(t&&!t.hidden&&p&&(t.offsetLeft>p.clientWidth*.3||t.offsetTop>p.clientHeight*.3)){if(!box.hidden){box.hidden=true;sig=''}return} // the banner docked beside the map (#546): under it is no place to stand, and the scene has the company for now
  const s=[v.road,v.company,v.phase,v.waits||'',top].join('|');if(s===sig)return;sig=s;box.hidden=false;box.style.top=top+'px';box.textContent='';
  const h=document.createElement('div');h.className='tt';h.textContent=String(v.road||'the road').toUpperCase()+(v.company?' · '+v.company:'');box.append(h);
  const f=document.createElement('div');f.className='tf';f.textContent=v.waits||PHASE[v.phase]||'';box.append(f)}

// The view that picked a region looks at a land that is gone; a hero of the land left behind is frozen with it.
function arrived(stage){if(stage==='shown'){cinemaArrive();return}
  fillRegionPicker();if(cam.view==='region')setView(followedMembers().length?'fellow':'map');
  if(!(cam.sel&&S.agents.includes(cam.sel))){const C=followedCompany(),a=C&&followedMembers().map(c=>c.hero).find(h=>h&&h.state!=='dead');select(a||null)}
  sceneLook(cam);cinemaArrive(true);syncView()}
export function initMapSwitch(){onMapArrive(arrived)}
