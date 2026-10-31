// Speed and view buttons, hero selection by click or list.
import {T} from '../world/tiles.js';
import {S} from '../sim/index.js';
import {cam} from '../render/draw.js';
import {renderHero,renderTops,ranked,setPicker} from './panels.js';

const $=id=>document.getElementById(id);
export const ctl={speed:1};

export function setView(v){cam.view=v;$('vMap').setAttribute('aria-pressed',String(v==='map'));$('vFol').setAttribute('aria-pressed',String(v==='follow'));
  $('hint').textContent=v==='map'?'Tap a hero to follow':'Following '+(cam.sel?cam.sel.name:'')}

export function select(a){cam.sel=a;S.pinned=a;if(a){cam.camX=a.x*T;cam.camY=a.y*T}renderHero();renderTops();if(cam.view==='follow')setView('follow')}

export function initControls(renderer){
  document.querySelectorAll('[data-sp]').forEach(b=>b.addEventListener('click',()=>{ctl.speed=+b.dataset.sp;document.querySelectorAll('[data-sp]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)))}));
  $('vMap').onclick=()=>setView('map');
  $('vFol').onclick=()=>{if(!cam.sel)select(ranked()[0]);setView('follow')};
  $('vNext').onclick=()=>{const r=ranked();const i=cam.sel?r.indexOf(cam.sel):-1;select(r[(i+1)%r.length]);setView('follow')};
  setPicker(a=>{select(a);setView('follow')});
  $('screen').addEventListener('click',e=>{const {x:wx,y:wy}=renderer.screenToWorld(e.clientX,e.clientY);
    let best=null,bd=cam.view==='map'?2.2:1.2;for(const a of S.agents){if(a.hidden||a.state==='dead')continue;const d=Math.hypot(a.x-wx,a.y-.4-wy);if(d<bd){bd=d;best=a}}
    if(best){select(best);setView('follow')}});
}
