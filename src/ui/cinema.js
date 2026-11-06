// The cinema view (#979): the map as the whole window, a director camera (render/director.js) and thin overlays.
// One key (C, Esc leaves too), one button in the View group and one on the title screen. The rest of the page is not rebuilt or
// moved: body.cinema pins #screen over the window and hides the .shell by visibility, so every panel keeps its place,
// scroll position, open rows and focus and goes on patching itself; a hole keeps #screen's height in the column, so
// leaving puts back the page exactly as it was. The camera's view, zoom and centre are saved on entering and put back on leaving.
// What stays on the screen:
//   plates   one slim plate per place of the followed company along the bottom edge: face, name, level, health, and a word
//            when something is wrong. A click (or keys 1-9) picks that hero and the director goes to them.
//   clock    the day, the hour and the land under the camera, top right; says so when the world is paused or held.
//   caption  the last line or two of the company's talk or the Chronicle, fading after a while; while the director looks
//            elsewhere, a line naming what it is looking at.
//   the Table banner, the run gate, the DM's prep, the runner alerts and the gambit hold bar live inside #screen, so
//   they show here as they do anywhere, above the overlays, with their buttons working. A held world says why.
//   bar      moving the pointer shows Pause, 1x, 3x, 8x and Leave at the top left for a few seconds; they press the real
//            speed buttons. It hides again, with the cursor.
// Nothing here touches the sim: it reads S, and the wish to be in the view is kept per viewer (eldmoor.cinema).
import {S,onLog} from '../sim/index.js';
import {maxHp} from '../sim/heroes.js';
import {ZONES,zoneAt} from '../world/map.js';
import {W,H} from '../world/tiles.js';
import {U as T} from '../render/tile.js';
import {cam} from '../render/draw.js';
import {createDirector} from '../render/director.js';
import {heroSprite,outlined} from '../render/sprites.js';
import {classColor} from '../core/colors.js';
import {chatVisible} from '../core/chatview.js';
import {ctl,select,syncView} from './controls.js';
import {followedCompany,followedMembers} from './companyview.js';
import {members} from '../sim/company.js';
import {chronicleShows} from './fellowship.js';
import {downView,pips} from './downview.js';

const $=id=>document.getElementById(id);
const el=(tag,cls,text)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(text!=null)d.textContent=text;return d};
const setText=(n,v)=>{v=v==null?'':String(v);if(n._v!==v){n._v=v;n.textContent=v}};
const KEY='eldmoor.cinema';
export const CAPTION={HOLD_S:14,GAP_S:4,KEEP:2,QUEUE:6,MAX:130}; // seconds a line stays, seconds between lines, lines shown, lines waiting, characters
const CHROME_S=3; // seconds the pointer's bar stays after the last move
const store=()=>{try{return typeof localStorage!=='undefined'?localStorage:null}catch(e){return null}};
export const cinemaWish=()=>{try{return store().getItem(KEY)==='1'}catch(e){return false}};
export function setCinemaWish(v){try{if(v)store().setItem(KEY,'1');else store().removeItem(KEY)}catch(e){}}

let R=null,root=null,on=false,saved=null,hole=null,plates=null,clock=null,place=null,capBox=null,sight=null,chrome=null,rosterSig=null,moved=0,backTo=null;
const director=createDirector({still:()=>ctl.held||ctl.speed===0,reduced:()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches});
export const cinemaOn=()=>on;
export const cinemaDirector=()=>director;
const now=()=>Date.now()/1000;
const mates=()=>{const C=followedCompany();return C?members(C):[]};

// ---- caption: what was said, then what happened ----
const known=new WeakSet();let lines=[],queue=[],shownAt=0;
const plain=ps=>(ps||[]).map(p=>typeof p==='string'?p:p&&p.kind==='hero'?p.name:p&&p.t||'').join('');
const clip=t=>{t=String(t||'').replace(/\s+/g,' ').trim();return t.length>CAPTION.MAX?t.slice(0,t.lastIndexOf(' ',CAPTION.MAX-1))+'…':t};
function enqueue(l){queue.push(l);if(queue.length>CAPTION.QUEUE)queue.shift()}
function hearChat(){for(const a of mates()){for(const e of a.chat||[]){if(known.has(e))continue;known.add(e);
    if(e.whisper||!chatVisible(e,S)||!on)continue;const f=e.from||{},dm=f.kind==='dm';
    enqueue({who:dm?'':f.name||'',col:f.kind==='hero'||f.cls?classColor(f.cls):'',text:clip(e.text),story:dm||!!e.emote})}}}
function heardChronicle(e){if(!on||!chronicleShows(e))return;enqueue({who:'',col:'',text:clip(plain(e.parts)),story:true})}
function lineEl(l){const d=el('div','cinl'+(l.story?' story':''));if(l.who){const n=el('span','cinw',l.who+': ');if(l.col)n.style.color=l.col;d.append(n)}d.append(l.text);d._l=l;return d}
function renderCaption(){const t=now();
  if(queue.length&&t-shownAt>=CAPTION.GAP_S){const l=queue.shift();l.at=t;shownAt=t;lines.push(l);if(lines.length>CAPTION.KEEP)lines.shift()}
  lines=lines.filter(l=>t-l.at<CAPTION.HOLD_S);
  const kids=[...capBox.children];for(const k of kids)if(!lines.includes(k._l))k.remove();
  for(const l of lines)if(!kids.some(k=>k._l===l))capBox.append(lineEl(l));
  const s=director.sightLabel;setText(sight,s);sight.hidden=!s}

// ---- plates ----
function plateFor(c,i){const b=el('button','cinp');b.type='button';b.dataset.hid=c.hero?c.hero.id:'';const face=el('canvas','cinf');face.setAttribute('aria-hidden','true');
  const a=c.hero;if(a)try{const sp=outlined(heroSprite(a,false,0)),x=face.getContext('2d');face.width=sp.width;face.height=Math.min(sp.height,Math.ceil(sp.width*.9));x.imageSmoothingEnabled=false;x.drawImage(sp,0,0)}catch(e){}
  const txt=el('span','cint'),row=el('span','cinr'),nm=el('span','cinn',a?a.name:c.label),st=el('span','cins'),m=el('span','cinm'),fill=el('i');
  if(a)nm.style.color=classColor(a.cls);row.append(nm,st);m.append(fill);txt.append(row,m);b.append(face,txt);b._p={a,st,fill,nm};
  if(a)b.title=a.name+', place '+(i+1)+': press '+(i+1)+' or click to look at them';return b}
const WORD={fight:'fighting',duel:'duelling',ghost:'ghost',dungeon:'below',raid:'raiding',camp:'at camp'};
function paintPlate(b){const {a,st,fill}=b._p;if(!a)return;const dead=a.state==='dead',v=downView(a),mh=maxHp(a),pct=dead?0:Math.max(0,Math.min(100,Math.round(a.hp/Math.max(1,mh)*100)));
  const word=dead?'fallen':v?(v.stable?'stable':'down '+pips(v.s,v.of3)+' '+pips(v.f,v.of)):WORD[a.state]||'Lv '+a.lvl;setText(st,word);
  const w=pct+'%';if(fill._w!==w){fill._w=w;fill.style.width=w}
  const cls='cinp'+(dead?' dead':v?' down':pct<35?' low':'')+(cam.sel===a?' sel':'');if(b._c!==cls){b._c=cls;b.className=cls}}
function renderPlates(){const cols=followedMembers().filter(c=>c.hero),k=cols.map(c=>c.hero.id).join();
  if(k!==rosterSig){rosterSig=k;plates.replaceChildren(...cols.map(plateFor))}
  for(const b of plates.children)paintPlate(b)}

// ---- clock ----
function renderClock(){const t=$('clock'),cx=Math.max(0,Math.min(W-1,(cam.camX||0)/T)),cy=Math.max(0,Math.min(H-1,(cam.camY||0)/T));
  setText(clock,(t?t.textContent:'')+(ctl.held?' · held':ctl.speed===0?' · paused':''));setText(place,ZONES[zoneAt(cx,cy)]||'')}

// The 0.3 s tick: only while the view is open, and only what changed.
export function renderCinema(){if(!on||!root)return;hearChat();renderCaption();renderPlates();renderClock();
  const live=now()-moved<CHROME_S;document.body.classList.toggle('cinidle',!live);chrome.hidden=!live}

function build(){const scr=$('screen');if(!scr)return false;root=el('div','cinema');root.id='cinema';root.hidden=true;
  const top=el('div','cinclock');clock=el('div','cinc');place=el('div','cinz');top.append(clock,place);
  const cap=el('div','cincap');cap.setAttribute('aria-live','off');sight=el('div','cinsight');sight.hidden=true;capBox=el('div','cinlines');cap.append(sight,capBox);
  plates=el('div','cinplates');plates.setAttribute('role','group');plates.setAttribute('aria-label','The company');
  plates.addEventListener('click',e=>{const t=e.target&&e.target.closest?e.target.closest('.cinp'):null;if(t&&t._p&&t._p.a&&t._p.a.state!=='dead')select(t._p.a);e.stopPropagation()});
  chrome=el('div','cinbar');chrome.hidden=true;chrome.setAttribute('role','group');chrome.setAttribute('aria-label','Cinema view');
  for(const [n,t] of [[0,'Pause'],[1,'1×'],[3,'3×'],[8,'8×']]){const b=el('button','mini',t);b.type='button';b.addEventListener('click',e=>{e.stopPropagation();const s=$('sp'+n);if(s)s.click()});chrome.append(b)}
  const out=el('button','mini','Leave · C');out.type='button';out.dataset.cinleave='1';out.addEventListener('click',e=>{e.stopPropagation();leaveCinema()});chrome.append(out);
  root.append(top,cap,plates,chrome);scr.append(root);
  hole=el('div','cinhole');hole.hidden=true;scr.parentNode.insertBefore(hole,scr);
  scr.addEventListener('pointermove',()=>{moved=now();if(on&&chrome.hidden){chrome.hidden=false;document.body.classList.remove('cinidle')}},true);return true}

function canvasSize(){const c=$('cv');return [c&&c.width||1280,c&&c.height||800]}
const syncBtn=()=>{const b=$('vCin');if(b)b.setAttribute('aria-pressed',String(on))};
export function enterCinema(){if(on||(!root&&!build()))return false;const scr=$('screen'),r=scr.getBoundingClientRect?scr.getBoundingClientRect():{height:0};
  saved={view:cam.view,zoom:cam.zoom,camX:cam.camX,camY:cam.camY,sc:cam.sc,x:window.scrollX||0,y:window.scrollY||0};
  backTo=document.activeElement===$('vCin')?$('vCin'):null;
  hole.style.height=(r.height||0)+'px';hole.hidden=false;on=true;document.body.classList.add('cinema');root.hidden=false;
  if(R&&R.resize)R.resize();const [w,h]=canvasSize();cam.view='cinema';cam.director=director;director.enter(cam,w,h);
  for(const a of mates())for(const e of a.chat||[])known.add(e); // the caption starts from now
  lines=[];queue=[];capBox.replaceChildren();moved=now();setCinemaWish(true);syncBtn();renderCinema();return true}
export function leaveCinema(){if(!on)return false;on=false;cam.director=null;Object.assign(cam,{view:saved.view,zoom:saved.zoom,camX:saved.camX,camY:saved.camY,sc:saved.sc});
  document.body.classList.remove('cinema');document.body.classList.remove('cinidle');root.hidden=true;hole.hidden=true;
  if(R&&R.resize)R.resize();if(window.scrollTo)window.scrollTo(saved.x,saved.y);setCinemaWish(false);syncBtn();syncView();
  if(backTo&&backTo.focus)backTo.focus();backTo=null;return true}
export const toggleCinema=()=>on?leaveCinema():enterCinema();
// Opening the world: the view comes back on when it was on, or was asked for on the title screen.
export function resumeCinema(){if(cinemaWish())enterCinema()}

// C anywhere but in a form control or behind the title and setup pages; Esc leaves, before anything else takes the key.
export function cinemaKey(e){if(e.ctrlKey||e.altKey||e.metaKey||e.repeat)return false;const k=e.key;if(k!=='c'&&k!=='C'&&!(k==='Escape'&&on))return false;
  const t=e.target,tn=t&&t.tagName?String(t.tagName).toUpperCase():'';if(tn==='INPUT'||tn==='TEXTAREA'||tn==='SELECT'||(t&&(t.isContentEditable||t.contentEditable==='true')))return false;
  for(const id of ['title','setup']){const o=$(id);if(o&&!o.hidden)return false}
  toggleCinema();return true}
export function initCinema(renderer){R=renderer;build();const b=$('vCin');if(b)b.addEventListener('click',()=>toggleCinema());
  document.addEventListener('keydown',e=>{if(cinemaKey(e)){e.preventDefault();e.stopPropagation();if(e.stopImmediatePropagation)e.stopImmediatePropagation()}},true);
  onLog(heardChronicle)}
