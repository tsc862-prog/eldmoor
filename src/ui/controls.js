// Speed, view and zoom buttons, wheel zoom and drag panning on the map, hero
// selection by click or list.
import {T} from '../world/tiles.js';
import {S} from '../sim/index.js';
import {cam} from '../render/draw.js';
import {renderHero,renderTops,ranked,setPicker} from './panels.js';

const $=id=>document.getElementById(id);
export const ctl={speed:1};
let R=null; // the renderer (camera API), set by initControls
// Drags shorter than this (CSS px) are clicks.
const DRAG_PX=4;

// Reflect the camera state in the view buttons and the hint.
export function syncView(){const map=cam.view!=='follow';
  $('vMap').setAttribute('aria-pressed',String(map&&cam.zoom===1));$('vFol').setAttribute('aria-pressed',String(!map));
  $('hint').textContent=!map?'Following '+(cam.sel?cam.sel.name:''):cam.zoom===1?'Tap a hero to follow · wheel to zoom':'Drag to pan · wheel to zoom'}

// 'map' is the free camera (the Whole map button also resets the zoom); 'follow' tracks cam.sel.
export function setView(v){cam.view=v;if(v==='map'&&R)R.setZoom(1);syncView()}

export function select(a){cam.sel=a;S.pinned=a;if(a){cam.camX=a.x*T;cam.camY=a.y*T}renderHero();renderTops();if(cam.view==='follow')setView('follow')}

export function initControls(renderer){R=renderer;
  document.querySelectorAll('[data-sp]').forEach(b=>b.addEventListener('click',()=>{ctl.speed=+b.dataset.sp;document.querySelectorAll('[data-sp]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)))}));
  $('vMap').onclick=()=>setView('map');
  $('vFol').onclick=()=>{if(!cam.sel)select(ranked()[0]);setView('follow')};
  $('vNext').onclick=()=>{const r=ranked();const i=cam.sel?r.indexOf(cam.sel):-1;select(r[(i+1)%r.length]);setView('follow')};
  $('zIn').onclick=()=>renderer.setZoom(renderer.stepZoom(renderer.currentZoom(),1));
  $('zOut').onclick=()=>renderer.setZoom(renderer.stepZoom(renderer.currentZoom(),-1));
  renderer.onCamChange(syncView);
  setPicker(a=>{select(a);setView('follow')});

  const scr=$('screen');
  // wheel: zoom one step around the cursor (in follow mode this drops to the free camera)
  scr.addEventListener('wheel',e=>{e.preventDefault();if(e.deltaY)renderer.zoomAt(e.clientX,e.clientY,e.deltaY<0?1:-1)},{passive:false});
  // drag: pan; a press that moves less than DRAG_PX stays a click
  let drag=null,dragged=false;
  scr.addEventListener('pointerdown',e=>{if(e.button!==undefined&&e.button!==0)return;drag={id:e.pointerId,x:e.clientX,y:e.clientY};dragged=false});
  scr.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.id)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
    if(!dragged){if(Math.hypot(dx,dy)<DRAG_PX)return;dragged=true;scr.classList.add('drag');if(scr.setPointerCapture)try{scr.setPointerCapture(e.pointerId)}catch(_){}}
    renderer.panBy(dx,dy);drag.x=e.clientX;drag.y=e.clientY});
  const endDrag=e=>{if(!drag||(e.pointerId!==undefined&&e.pointerId!==drag.id))return;drag=null;scr.classList.remove('drag')};
  scr.addEventListener('pointerup',endDrag);scr.addEventListener('pointercancel',endDrag);
  // click: select the nearest hero (the pick radius shrinks as the view zooms in)
  scr.addEventListener('click',e=>{if(dragged){dragged=false;return}
    const {x:wx,y:wy}=renderer.screenToWorld(e.clientX,e.clientY);
    let best=null,bd=cam.view==='follow'?1.2:Math.max(1.2,2.2/cam.zoom);for(const a of S.agents){if(a.hidden||a.state==='dead')continue;const d=Math.hypot(a.x-wx,a.y-.4-wy);if(d<bd){bd=d;best=a}}
    if(best){select(best);setView('follow')}});
  syncView();
}
