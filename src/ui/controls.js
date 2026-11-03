// Speed, view and zoom buttons, wheel zoom and drag panning on the map, hero
// selection by click or list.
import {T} from '../world/tiles.js';
import {S} from '../sim/index.js';
import {cam} from '../render/draw.js';
import {cryptAt,lairAt,openDungeon} from '../render/dungeonview.js'; // the dungeon view (#85): a click on a crypt's door opens it
import {renderHero,renderTops,ranked,setPicker} from './panels.js';
import {companies} from '../sim/company.js';
import {followedCompany,followedMembers,companyLabel,followNext,storyLead} from './companyview.js'; // the follow cycle (#456)
import {showDock} from './layout.js'; // the dock (#546): a click on a hero opens its Hero tab
import {regionBox,regionList,getRegion,setRegion} from './region.js'; // region view (#430)
import {renderConditions} from './conditions.js';
import {refreshChronicle} from './fellowship.js';
import {hoverHero} from './purposeview.js'; // the map tooltip: what the hovered hero is trying to do (#534)

// Follow Fellowship (#68), Follow <company> (#456): frame every living member of the followed company who is out in the
// open (not inside the Crypt).
export function fellowFrame(){const L=followedMembers().map(m=>m.hero).filter(a=>a&&a.state!=='dead'&&!a.hidden);if(!L.length)return null;
  let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;for(const a of L){x0=Math.min(x0,a.x);y0=Math.min(y0,a.y);x1=Math.max(x1,a.x);y1=Math.max(y1,a.y)}
  return {x:(x0+x1)/2,y:(y0+y1)/2,w:x1-x0,h:y1-y0}}
cam.frame=fellowFrame;
cam.regionFrame=()=>cam.region==null?null:regionBox(cam.region); // the picked region's box, for the 'region' view

const $=id=>document.getElementById(id);
export const ctl={speed:1,held:false}; // held: the run gate (ui/rungate.js) keeps the world paused; speed stays the owner's wish
let R=null; // the renderer (camera API), set by initControls
// Drags shorter than this (CSS px) are clicks.
const DRAG_PX=4;

// Reflect the camera state in the view buttons and the hint.
export function syncView(){const fel=cam.view==='fellow',reg=cam.view==='region',map=cam.view!=='follow'&&!fel&&!reg;
  $('vMap').setAttribute('aria-pressed',String(map&&cam.zoom===1));$('vFol').setAttribute('aria-pressed',String(cam.view==='follow'));
  const vf=$('vFel'),C=followedCompany(),n=companies().length,lbl=companyLabel(C);
  if(vf){vf.hidden=!n;vf.setAttribute('aria-pressed',String(fel));
    // one company: "Fellowship" as before (or the solo's name); several: "Follow <company>", a click again moves to the next
    const t=n>1?'Follow '+lbl:C&&C.slots?'Fellowship':lbl;if(vf.textContent!==t)vf.textContent=t;
    const tip=n>1?'Frame '+lbl+(fel?'. Click again for the next company ('+n+' in all)':'; click again to cycle through the '+n+' companies'):'Frame the whole '+(C&&C.slots?'Fellowship':'company');if(vf.title!==tip)vf.title=tip}
  const vr=$('vReg');if(vr){const want=getRegion()==null?'':String(getRegion());if(vr.value!==want)vr.value=want}
  const h=$('hint'),ht=reg?'Viewing '+(vr&&vr.selectedOptions&&vr.selectedOptions[0]?vr.selectedOptions[0].textContent:'a region'):fel?'Following '+(C&&C.slots&&n===1?'the Fellowship':lbl):cam.view==='follow'?'Following '+(cam.sel?cam.sel.name:''):cam.zoom===1?'Tap a hero to follow · wheel to zoom':'Drag to pan · wheel to zoom';if(h.textContent!==ht)h.textContent=ht}
// The follow button and hint name the followed company: refresh them when the companies change (called by the frames'
// 0.3 s render; a no-op while nothing changed).
// The selected hero follows the follow cycle (#546): when the followed company changes, the dossier moves to its leader
// unless the selected hero rides with it already.
let followSig='',followWas;
export function syncFollow(){const C=followedCompany(),k=companies().map(x=>x.id).join(',')+'|'+(C?C.id+':'+companyLabel(C):'');if(k===followSig)return;followSig=k;
  const id=C?C.id:null,moved=followWas!==undefined&&id!==followWas;followWas=id;
  if(moved&&C&&!(cam.sel&&C.ids.includes(cam.sel.id))){const L=storyLead(C);if(L)select(L)}
  syncView()}
// The hero the dossier opens on (#546): the saved pick when it rides with the followed company (or there is none), else
// that company's leader; without a company the saved pick or the top hero, as before.
export function startHero(){const p=S.pinned&&typeof S.pinned.x==='number'&&S.agents.includes(S.pinned)?S.pinned:null,C=followedCompany();
  if(C&&!(p&&C.ids.includes(p.id)))return storyLead(C)||p||ranked()[0];return p||ranked()[0]}

// 'map' is the free camera (the Whole map button also resets the zoom); 'follow' tracks cam.sel.
export function setView(v){cam.view=v;if(v==='map'&&R)R.setZoom(1);syncView()}

// Region view (#430): fill the picker from the world's regions and wire it. A region frames the camera on it and
// narrows the lists; All regions clears that. Follow and Fellowship still work inside the filter.
export function pickRegion(v){const i=v===''||v==null?null:+v;setRegion(i);
  if(i==null){if(cam.view==='region')setView('map')}else setView('region');
  renderTops();renderConditions();refreshChronicle();syncView()}
function initRegionPicker(){const vr=$('vReg');if(!vr)return;
  for(const r of regionList()){const o=document.createElement('option');o.value=String(r.i);o.textContent=r.name;vr.append(o)}
  vr.onchange=()=>pickRegion(vr.value)}

// The living hero nearest a world point (tiles), within a pick radius that shrinks as the view zooms in; null for none.
export function heroAt(wx,wy){let best=null,bd=cam.view==='follow'?1.2:Math.max(1.2,2.2/cam.zoom);
  for(const a of S.agents){if(a.hidden||a.state==='dead')continue;const d=Math.hypot(a.x-wx,a.y-.4-wy);if(d<bd){bd=d;best=a}}return best}
export function select(a){cam.sel=a;S.pinned=a;if(a){cam.camX=a.x*T;cam.camY=a.y*T}renderHero();renderTops();if(cam.view==='follow')setView('follow')}

export function initControls(renderer){R=renderer;
  document.querySelectorAll('[data-sp]').forEach(b=>b.addEventListener('click',()=>{if(ctl.held&&+b.dataset.sp>0)return; // the run gate: only Pause works while a seat is missing
    ctl.speed=+b.dataset.sp;document.querySelectorAll('[data-sp]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)))}));
  $('vMap').onclick=()=>setView('map');
  $('vFol').onclick=()=>{if(!cam.sel)select(ranked()[0]);setView('follow')};
  // the follow cycle (#456): the first click frames the followed company, each next click follows the next company
  if($('vFel'))$('vFel').onclick=()=>{if(!companies().length){setView('map');return}if(cam.view==='fellow'&&companies().length>1)followNext();setView('fellow')};
  $('vNext').onclick=()=>{const r=ranked();const i=cam.sel?r.indexOf(cam.sel):-1;select(r[(i+1)%r.length]);setView('follow')};
  $('zIn').onclick=()=>renderer.setZoom(renderer.stepZoom(renderer.currentZoom(),1));
  $('zOut').onclick=()=>renderer.setZoom(renderer.stepZoom(renderer.currentZoom(),-1));
  renderer.onCamChange(syncView);initRegionPicker();
  setPicker(a=>{select(a);setView('follow');showDock('hero')});

  const scr=$('screen');
  // wheel: zoom one step around the cursor (in follow mode this drops to the free camera)
  scr.addEventListener('wheel',e=>{e.preventDefault();if(e.deltaY)renderer.zoomAt(e.clientX,e.clientY,e.deltaY<0?1:-1)},{passive:false});
  // drag: pan; a press that moves less than DRAG_PX stays a click
  let drag=null,dragged=false;
  scr.addEventListener('pointerdown',e=>{if(e.button!==undefined&&e.button!==0)return;drag={id:e.pointerId,x:e.clientX,y:e.clientY};dragged=false});
  // hover (a mouse only): the nearest hero under the pointer gets the purpose tooltip and its map overlays (render/purposefx.js)
  scr.addEventListener('pointermove',e=>{if(drag||(e.pointerType&&e.pointerType!=='mouse'))return;const w=renderer.screenToWorld(e.clientX,e.clientY);hoverHero(heroAt(w.x,w.y),e.clientX,e.clientY)});
  scr.addEventListener('pointerleave',()=>hoverHero(null));
  scr.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.id)return;if(cam.hover)hoverHero(null);const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
    if(!dragged){if(Math.hypot(dx,dy)<DRAG_PX)return;dragged=true;scr.classList.add('drag');if(scr.setPointerCapture)try{scr.setPointerCapture(e.pointerId)}catch(_){}}
    renderer.panBy(dx,dy);drag.x=e.clientX;drag.y=e.clientY});
  const endDrag=e=>{if(!drag||(e.pointerId!==undefined&&e.pointerId!==drag.id))return;drag=null;scr.classList.remove('drag')};
  scr.addEventListener('pointerup',endDrag);scr.addEventListener('pointercancel',endDrag);
  // click: select the nearest hero (the pick radius shrinks as the view zooms in)
  scr.addEventListener('click',e=>{if(dragged){dragged=false;return}
    const {x:wx,y:wy}=renderer.screenToWorld(e.clientX,e.clientY);
    const best=heroAt(wx,wy);
    if(best){select(best);setView('follow');showDock('hero')}else{const L=cryptAt(wx,wy)||lairAt(wx,wy);if(L)openDungeon(L)}}); // a crypt's door or a lair's ring (the raid arena, #85)
  syncView();
}
