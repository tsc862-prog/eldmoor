// One palette for names and markers (owner request, #168/#169). Pure: no DOM, no sim writes.
//   - A Fellowship member is coloured by CLASS: classColor(cls), taken from the class's own accent
//     in data/classes.js (CLS[cls].acc), only lifted when it would be too dark on the dark theme. A new
//     class (#83) gets a colour by being in CLS; a class with no accent gets a stable hue from its name.
//   - Everyone else who speaks or is drawn (townsfolk, DM-placed people, DM-voiced characters, enemy
//     heroes, foes) is coloured by DISPOSITION toward the Fellowship: hostile red, neutral amber,
//     friendly green, in muted tones, and always marked by a shape as well (an underline in the DOM,
//     [brackets] on the map) so they never read as a class colour.
// The role (Tank, Healer, DPS) stays a text tag on the frames, not a colour.
import {CLS} from '../data/classes.js';

const hex=c=>{const m=/^#?([0-9a-f]{6})$/i.exec(c||'');return m?[0,2,4].map(i=>parseInt(m[1].slice(i,i+2),16)):null};
const toHex=v=>'#'+v.map(x=>Math.max(0,Math.min(255,Math.round(x))).toString(16).padStart(2,'0')).join('');
const lum=v=>(.299*v[0]+.587*v[1]+.114*v[2])/255;
// Lift a colour towards white until it reads on the dark panels (luma at least `min`).
function lift(c,min=.5){let v=hex(c);if(!v)return c;let t=0;while(lum(v)<min&&t<1){t+=.1;v=hex(c).map(x=>x+(255-x)*t)}return toHex(v)}
function hueColor(name){let h=0;for(const ch of String(name||'?'))h=(h*31+ch.charCodeAt(0))%360;
  const s=.65,l=.62,k=n=>(n+h/30)%12,a=s*Math.min(l,1-l),f=n=>l-a*Math.max(-1,Math.min(k(n)-3,Math.min(9-k(n),1)));return toHex([f(0)*255,f(8)*255,f(4)*255])}
const cache={};
// Only where the accent alone is not enough on the dark theme: the Warrior's steel grey and the Priest's cream read as one
// colour in a chat line, so the Warrior takes a lavender steel. Everything else is its accent, lifted if too dark.
const ADJUST={Warrior:'#b3a6e6'};
export function classColor(cls){const k=String(cls||'');if(cache[k])return cache[k];const c=CLS[k];return cache[k]=ADJUST[k]||(c&&c.acc?lift(c.acc):hueColor(k))}
// A class colour for each class in the table (for a legend).
export const classPalette=()=>Object.keys(CLS).map(k=>[k,classColor(k)]);

export const DISP={hostile:{color:'#e0705f',label:'hostile'},neutral:{color:'#cfae5c',label:'neutral'},friendly:{color:'#72bf84',label:'friendly'}};
const KINDS=['hostile','neutral','friendly'];
// Disposition of a non-member toward the Fellowship `F` (sim/company.js slotted(), may be null): 'hostile', 'neutral',
// 'friendly', or null for someone who gets no disposition (a Fellowship member, the Narrator).
// Reads, in order: npc.hostile, npc.mood and npc.attitude (an NPC conversation's outcome, #170, or a DM
// placed person's attitude), then the defaults: an enemy-faction hero or a foe of an open hostile scene is
// hostile; townsfolk and placed people of the Fellowship's faction are friendly; others neutral.
// `now` (S.gameMin, optional): the DM's attitude entries (`x.att`, levers.js `set_attitude`) count while they last;
// a hostile one wins, 'wary' reads as neutral. This is the one place a map ring, nameplate, bubble or minimap dot learns it.
const member=(x,F)=>!!(x&&F&&x.company===F.id&&Array.isArray(F.ids)&&F.ids.includes(x.id)); // one of F's heroes (#588)
export function dispositionOf(x,F,now){
  if(!x||member(x,F)||x.kind==='dm')return null;
  if(x.hostile===true)return 'hostile';
  let wary=false;for(const e of x.att||[]){if(now!=null&&e.until!=null&&e.until<=now)continue;if(e.a==='hostile')return 'hostile';if(e.a==='wary'||e.a==='neutral')wary=true}
  let m=x.mood!=null?x.mood:x.attitude;if(m==='wary')m='neutral';if(KINDS.includes(m))return m;
  if(wary)return 'neutral';
  if(x.kind==='foe'||x.kind==='mob'||x.sceneFoe)return 'hostile';
  if(x.cls&&x.fac!=null)return F&&x.fac!==F.fac?'hostile':null; // a hero: enemy faction is hostile, a fellow-faction hero keeps the faction colour
  if(F&&x.fac!=null)return x.fac===F.fac?'friendly':'neutral';
  return 'neutral'}
// How to draw `x`: {kind:'class'|'hostile'|'neutral'|'friendly'|null, color, npc}. `npc` is true when the
// shape cue (underline, brackets) applies. A hero with no class colour and no disposition gives kind null.
export function toneOf(x,F,now){
  if(member(x,F)&&x.cls)return {kind:'class',color:classColor(x.cls),npc:false};
  const d=dispositionOf(x,F,now);if(d)return {kind:d,color:DISP[d].color,npc:true};
  return {kind:null,color:null,npc:false}}
// Text for a map label or bubble header: NPCs and foes in [brackets].
export const toneName=(x,t)=>t&&t.npc?'['+x.name+']':x.name;
