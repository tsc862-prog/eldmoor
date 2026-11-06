// What a hero is trying to do (issue #534), as the watcher sees it: the purpose line on the party frames and the dossier
// header, the hover tooltip on the map, and the Intent icons switch in Settings for the intent icons over heads.
// The words come from one read-only sim helper (src/sim/purpose.js purposeOf); the map overlays are drawn by
// src/render/purposefx.js for the followed (selected) or hovered hero only (cam.sel, cam.hover).
//
// A purpose line is one line that truncates (frames always, the dossier at phone width) with the full text as its title;
// a tap on a truncated line opens it in full, a second tap closes it. Which lines are open is kept here by key, so the
// 0.3 s patch of the dossier and the frames' in-place updates never close a line the owner opened.
import {purposeOf} from '../sim/purpose.js';
import {S} from '../sim/index.js';
import {cam} from '../render/draw.js';
import {FX,setFx} from '../render/quality.js';
import {downPurpose} from './downview.js'; // the downed and the one tending them (#659)

export {purposeOf};
// The watcher's purpose: a downed hero bleeds out or lies stable, a helper tends them (#659); everyone else as the sim says.
export const purposeFor=a=>downPurpose(a)||purposeOf(a);
export const purposeLine=a=>a?purposeFor(a).line:'';
const opened=new Set();
const truncated=n=>!!n&&n.scrollWidth>n.clientWidth+1;
// A tap on a purpose line: open it when cut (or close it when open). Returns true when it took the tap, so the frame's own
// click (select and follow) is left alone only then.
export function tapPurpose(n){if(!n||!n.dataset||!n.dataset.pk)return false;const k=n.dataset.pk,open=opened.has(k);
  if(!open&&!truncated(n))return false;
  if(open)opened.delete(k);else opened.add(k);n.classList.toggle('open',!open);n.setAttribute('aria-expanded',String(!open));return true}
export const isOpen=k=>opened.has(k);
// Fill a purpose node: text, title, the kind (for its colour) and the open state. Writes only what changed.
export function setPurpose(n,a,key){const p=purposeFor(a),t=p.line;if(n._t!==t){n._t=t;n.textContent=t;n.title=t}
  const k=key+a.id;if(n.dataset.pk!==k)n.dataset.pk=k;const cls='purp p-'+p.kind+(opened.has(k)?' open':'')+(n._base?' '+n._base:'');if(n.className!==cls)n.className=cls;
  return p}

// ---- the map tooltip ----
let tip=null,xy=[0,0];
function place(){if(!tip)return;const pad=14,w=tip.offsetWidth,h=tip.offsetHeight,vw=window.innerWidth,vh=window.innerHeight;
  let x=xy[0]+pad,y=xy[1]+pad;if(x+w>vw-4)x=Math.max(4,xy[0]-w-pad);if(y+h>vh-4)y=Math.max(4,vh-h-4);tip.style.left=x+'px';tip.style.top=y+'px'}
function body(a){const p=purposeFor(a),d=document.createElement('div');
  const n=document.createElement('div');n.className='in f'+a.fac;n.textContent=a.name+' · Lv '+a.lvl+' '+a.cls;d.append(n);
  const g=document.createElement('div');g.className='ptgoal';g.textContent=p.goal+(p.target?' → '+p.target:'');d.append(g);
  if(p.why){const w=document.createElement('div');w.className='dm';w.textContent=p.why;d.append(w)}
  return {d,k:a.id+'|'+p.line}}
// The hovered hero on the map (set by ui/controls.js from the pointer): show or move the tooltip, or hide it with null.
export function hoverHero(a,cx,cy){if(cx!=null)xy=[cx,cy];
  if(!a||a.state==='dead'||a.hidden){if(cam.hover){cam.hover=null}if(tip)tip.style.display='none';return}
  cam.hover=a;if(!tip){tip=document.createElement('div');tip.className='itip floating ptip';tip.setAttribute('role','tooltip');document.body.append(tip)}
  const {d,k}=body(a);if(tip._k!==k){tip._k=k;tip.replaceChildren(...d.childNodes)}tip.style.display='block';place()}
export const mapTipText=()=>tip&&tip.style.display!=='none'?tip.textContent:'';
// Each 0.3 s tick: the hovered hero's words move on as the hero does (a hero who died or went inside drops it).
export function renderMapTip(){const a=cam.hover;if(!a)return;if(!S.agents.includes(a)){hoverHero(null);return}hoverHero(a)}

// ---- the Intent icons switch (Settings: the bar keeps to its few buttons, #145) ----
const KEY='eldmoor.intentIcons';
function readIcons(){try{const v=localStorage.getItem(KEY);return v==null?true:v==='1'}catch(_){return true}}
export function setIcons(on){cam.icons=!!on;try{localStorage.setItem(KEY,on?'1':'0')}catch(_){}
  const b=document.getElementById('vIcons');if(b){b.setAttribute('aria-pressed',String(!!on));b.textContent='Intent icons: '+(on?'on':'off')}}
// The effects switch beside it (#979, render/quality.js).
const fxLabel=()=>{const b=document.getElementById('vFx');if(b){b.setAttribute('aria-pressed',String(FX.full));b.textContent='Effects: '+(FX.full?'full':'lean')}};
export function initPurpose(){fxLabel();{const f=document.getElementById('vFx');if(f)f.onclick=()=>{setFx(!FX.full);fxLabel()}}
  setIcons(readIcons());const b=document.getElementById('vIcons');if(b)b.onclick=()=>setIcons(!cam.icons);
  // the dossier header's purpose line: a tap or Enter/Space opens a cut line in full (frames wire their own, ui/frames.js)
  const h=document.getElementById('hero');if(!h)return;
  h.addEventListener('click',e=>{const t=e.target,n=t&&t.closest?t.closest('.purp'):null;if(n)tapPurpose(n)});
  h.addEventListener('keydown',e=>{if(e.key!=='Enter'&&e.key!==' ')return;const t=e.target;if(!t||!t.classList||!t.classList.contains('purp'))return;if(tapPurpose(t))e.preventDefault()})}
