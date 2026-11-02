// What an agent-played hero has said and heard (owner's screenshot, with issue #163): members of a local-model
// Fellowship kept introducing themselves to each other and asking the same question twice, because their trimmed
// or fresh context no longer held what had been said. Owned by brain-builder. DOM-free, no RNG, agent heroes only
// (scripted speech never comes through here, so the headless sim is unchanged).
//   lineRefusal(a, text)   null, or the error the agent sees for a line it should not say again
//   noteSaid(a, text, L)   after an agent line: remember it, and that the listeners L heard a
//   metNames(a)            companions a has met: both have spoken in each other's hearing
//   heardLines(a, n)       the last n party and aloud lines a heard (its own marked), compact
import {S} from './state.js';

export const TALK={SAME:.8,LAST:5,HEARD:8,CUT:120};
const words=s=>new Set(String(s||'').toLowerCase().replace(/[^a-z0-9 ]+/g,' ').split(' ').filter(x=>x.length>2));
// shared words over the larger set: 1 for the same words in any order
export function sameness(x,y){const A=words(x),B=words(y);if(!A.size||!B.size)return 0;let n=0;for(const w of A)if(B.has(w))n++;return n/Math.max(A.size,B.size)}
// "Hello Aelett! I am Gwilett from Wendell's Ford, a Tarrow Rogue ..." : the speaker's own name with an introduction
export function isIntro(a,text){const t=String(text||''),first=String(a.name||'').split(' ')[0];
  if(!first||!new RegExp('\\b'+first.replace(/[^\w]/g,'')+'\\b','i').test(t))return false;
  return /\b(i am|i'm|my name|call me|introduce|nice to meet|pleased to meet)\b/i.test(t)}
const byId=id=>S.agents.find(x=>x.id===id)||null;
export function metIds(a){const h=a.talkHeard||{};return Object.keys(h).map(Number).filter(id=>{const b=byId(id);return b&&b.state!=='dead'&&(b.talkHeard||{})[a.id]})}
export const metNames=a=>metIds(a).map(id=>byId(id).name);
export const MSG_SAME='You already said that; say something new or act (propose, vote, lead_to, or answer a question you were asked).';
export const MSG_INTRO='You have already met your companions; no need to introduce yourself again. Say something new or act (propose, vote, lead_to, or answer a question you were asked).';
export function lineRefusal(a,text){if(!a||!a.player)return null;
  if((a.talkSaid||[]).some(s=>sameness(s,text)>=TALK.SAME))return MSG_SAME;
  if(isIntro(a,text)&&metIds(a).length)return MSG_INTRO;
  return null}
export function noteSaid(a,text,listeners){if(!a||!a.player)return;const L=a.talkSaid||(a.talkSaid=[]);L.push(String(text).slice(0,200));if(L.length>TALK.LAST)L.shift();
  for(const b of listeners||[])if(b&&b!==a&&b.kind==='hero'){(b.talkHeard||(b.talkHeard={}))[a.id]=1}}
export function heardLines(a,n=TALK.HEARD){const cut=t=>t.length>TALK.CUT?t.slice(0,TALK.CUT-1)+'…':t;
  return (a.chat||[]).filter(e=>e.from&&(e.party||e.trigger==='agent'||e.from.kind==='hero')).slice(-n)
    .map(e=>e.t+' '+(e.from===a?'(you)':e.from.name||'?')+(e.party?' [party]':'')+': '+cut(String(e.text||'')))}
