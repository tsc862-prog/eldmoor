// The Settings popover and the World menu (issue #145): the viewing switches (Table mode, scene sound, runner
// alert, world chatter, developer) live in one popover opened from the header, and Save / Load / Export /
// Import / New world fold under one "World" menu in the bar. The switches keep their own modules (table.js,
// runalert.js, mindctl.js) and ids; this file only opens, closes and wires World chatter.
//   popover(btn, pop)  toggle with aria-expanded; Escape and a click outside close it, focus returns to btn
import {setWorldChatter} from '../core/chatview.js';
import {S} from '../sim/state.js';

const $=id=>document.getElementById(id);
export function popover(btn,pop,{onOpen=()=>{}}={}){if(!btn||!pop)return null;
  const set=v=>{pop.hidden=!v;btn.setAttribute('aria-expanded',String(v));if(v)onOpen()};
  btn.addEventListener('click',()=>set(pop.hidden));
  pop.addEventListener('click',e=>{if(e.target.closest&&e.target.closest('[data-popclose]')){set(false);btn.focus()}});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!pop.hidden){set(false);btn.focus()}});
  document.addEventListener('pointerdown',e=>{if(!pop.hidden&&e.target&&!pop.contains(e.target)&&!btn.contains(e.target))set(false)});
  return {open:()=>set(true),close:()=>set(false),isOpen:()=>!pop.hidden}}

// Scripted chatter (#164): off by default, only the DM voices world characters. On: S.worldVoice='scripted' and the Chat tab shows it all.
function syncChat(){const b=$('vChat');if(!b)return;const on=S.worldVoice==='scripted';b.textContent='Scripted chatter: '+(on?'on':'off');b.setAttribute('aria-pressed',String(on))}

export function initSettings(after=()=>{}){
  popover($('setBtn'),$('setPop'),{onOpen:()=>{const f=[...$('setPop').querySelectorAll('.setrow button')].find(b=>!b.hidden);if(f&&f.focus)f.focus()}});
  const c=$('vChat');if(c)c.addEventListener('click',()=>{const on=S.worldVoice!=='scripted';S.worldVoice=on?'scripted':'dm';setWorldChatter(on);syncChat();after()});syncChat();
  // the World menu: a <details>; Escape or a click elsewhere folds it
  const w=$('wmenu');if(w){document.addEventListener('keydown',e=>{if(e.key==='Escape'&&w.open){w.open=false;const s=w.querySelector('summary');if(s&&s.focus)s.focus()}});
    document.addEventListener('pointerdown',e=>{if(w.open&&e.target&&!w.contains(e.target))w.open=false})}}
