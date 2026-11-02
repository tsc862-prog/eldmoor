// Table mode banner and switch (issue #68, phase B). Reads sim/table.js only.
//   banner  over the map while the Fellowship is at a scene: the scene, the DM's framing (with
//           the dice when it is a check), initiative order with the current turn marked, whose
//           turn it is ("Pellora is thinking… (5 s)") and the last act, then the outcome
//   switch  the View group's "Table: Auto / Off" button (Off = Watch mode, never pauses); kept
//           per viewer in localStorage
import {TABLE,bannerOf} from '../sim/table.js';
import {S} from '../sim/index.js';
import {patch} from './stable.js'; // update in place (#145)

const $=id=>document.getElementById(id);
const el=(tag,cls,text)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(text!=null)d.textContent=text;return d};
const plain=ps=>(ps||[]).map(p=>typeof p==='string'?p:p&&p.kind==='hero'?p.name:p&&p.t||'').join('');
const KEY='eldmoor.tableMode';
let sig='';

// A short 8-bit cue when a scene opens (Web Audio, no files). Talk scenes rise on a triangle wave, combat scenes
// (elite, ambush, boss, rescue) are a sharper square triple. Silent until the page has had a click or key press.
const SND='eldmoor.tableSound',COMBAT={elite:1,ambush:1,boss:1,rescue:1};
let snd=true,ctx=null,gesture=false,lastScene=null;
try{if(localStorage.getItem(SND)==='off')snd=false}catch(_){}
function wake(){gesture=true;try{const AC=window.AudioContext||window.webkitAudioContext;if(!ctx&&AC)ctx=new AC();if(ctx&&ctx.state==='suspended')ctx.resume()}catch(_){}}
function chime(kind){if(!snd||!gesture||!ctx||ctx.state!=='running')return;
  try{const fight=!!COMBAT[kind],t0=ctx.currentTime+.02,notes=fight?[[392,0],[523.25,.12],[659.25,.24]]:[[523.25,0],[783.99,.18]];
    for(const [f,dt] of notes){const o=ctx.createOscillator(),g=ctx.createGain();o.type=fight?'square':'triangle';o.frequency.value=f;
      g.gain.setValueAtTime(0,t0+dt);g.gain.linearRampToValueAtTime(fight?.05:.08,t0+dt+.02);g.gain.exponentialRampToValueAtTime(.0008,t0+dt+(fight?.14:.22));
      o.connect(g).connect(ctx.destination);o.start(t0+dt);o.stop(t0+dt+.25)}}catch(_){}}
// A distinct falling cue for the runner-stop alert (ui/runalert.js); respects the Sound switch.
export function alertCue(){if(!snd||!gesture||!ctx||ctx.state!=='running')return;
  try{const t0=ctx.currentTime+.02;[[440,0],[349.23,.14],[261.63,.28]].forEach(([f,dt])=>{const o=ctx.createOscillator(),g=ctx.createGain();o.type='sawtooth';o.frequency.value=f;
    g.gain.setValueAtTime(0,t0+dt);g.gain.linearRampToValueAtTime(.05,t0+dt+.02);g.gain.exponentialRampToValueAtTime(.0008,t0+dt+.16);o.connect(g).connect(ctx.destination);o.start(t0+dt);o.stop(t0+dt+.2)})}catch(_){}}
function syncSnd(){const b=$('vSnd');if(!b)return;b.hidden=!S.fellowship;b.textContent='Sound: '+(snd?'on':'off');b.setAttribute('aria-pressed',String(snd))}

function syncBtn(){const b=$('vTab');if(!b)return;b.hidden=!S.fellowship;b.textContent='Table: '+(TABLE.mode==='off'?'Off':'Auto');b.setAttribute('aria-pressed',String(TABLE.mode!=='off'))}
export function initTable(){
  try{const v=localStorage.getItem(KEY);if(v==='off'||v==='auto')TABLE.mode=v}catch(_){}
  const b=$('vTab');if(b)b.onclick=()=>{TABLE.mode=TABLE.mode==='off'?'auto':'off';try{localStorage.setItem(KEY,TABLE.mode)}catch(_){}syncBtn()};
  const s=$('vSnd');if(s)s.onclick=()=>{snd=!snd;try{localStorage.setItem(SND,snd?'on':'off')}catch(_){}if(snd)wake();syncSnd()};
  for(const ev of ['pointerdown','keydown'])document.addEventListener(ev,wake,{capture:true});
  syncBtn();syncSnd()}

// Called every frame with the host's speed: the sim pauses only at 1x.
export function renderTable(speed){TABLE.speed=speed>0?speed:1;syncBtn();syncSnd();
  if(S.table){if(S.table.id!==lastScene){lastScene=S.table.id;if(TABLE.speed<=1)chime(S.table.kind)}}else lastScene=null;
  const box=$('tbanner');if(!box)return;
  const b=bannerOf();if(!b){if(!box.hidden){box.hidden=true;sig=''}return}
  const s=[b.title,b.phase,b.line,b.last,b.turn,b.paused,b.narr,b.cast&&b.cast.join(',')].join('|');if(s===sig)return;sig=s;box.hidden=false;patch(box,box=>{
  const tt=el('div','tt','AT THE TABLE · '+b.title.toUpperCase());if(b.paused)tt.append(el('span','tp','WORLD PAUSED'));box.append(tt);
  box.append(el('div','tf',plain(b.frame)));
  if(b.narr)box.append(el('div','tf tnarr',b.narr)); // the DM's narrate line (issue #123)
  if(b.cast&&b.cast.length)box.append(el('div','to','Staged by the DM · '+b.cast.join(' · '))); // a staged scene's cast (issue #132)
  const o=el('div','to');b.order.forEach((a,i)=>{if(i)o.append(' · ');o.append(i===b.turn?el('b',null,'▶ '+a.name):a.name)});box.append(o);
  box.append(el('div','tl',b.line));if(b.last&&b.phase!=='outcome')box.append(el('div','to',b.last))},{force:true})}
