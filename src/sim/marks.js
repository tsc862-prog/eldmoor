// Hero tool: mark (#632). An agent hero names the spot it stands on (or a marker, landmark or place in sight): a private place
// in its lore (a.lore.p[name] = {how:'own', mk:1, x, y, zone, note, at, day}). places lists it ("yours"), move_to, hunt {where} and
// lead_to take its name (planOne in player.js). MARK.MAX a hero, the oldest folds. Sharing is in the game: a hero that hears the
// name said aloud by the one who marked it (say, a party shout, a courier; any line in a.chat) learns the place as heard of, with
// the speaker as its source (hearMarks, called where a hero reads what it heard). A scripted townsperson never learns it.
// Agent heroes only (lore's learner); no RNG; the seeded world is unchanged.
import {S} from './state.js';
import {dist,zoneAt,ZONES,CITY,LANDMARKS} from '../world/map.js';
import {cryptIf} from './crypts.js';
import {loreOf} from './lore.js';

export const MARK={MAX:12,NAME_MIN:3,NAME_MAX:40,NOTE_MAX:120,SIGHT:6};
const inTown=p=>CITY.some(c=>p.x>=c.x0-.5&&p.x<=c.x1+1.5&&p.y>=c.y0-.5&&p.y<=c.y1+1.5);
const day=()=>Math.floor(S.gameMin/1440)+1;
const bare=n=>String(n||'').replace(/^the\s+/i,'').trim();
const key=n=>bare(n).toLowerCase();
const clean=(s,n)=>String(s==null?'':s).replace(/\s+/g,' ').trim().slice(0,n);
const reEsc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

// Names a mark may not take: a region, a town, a landmark, a DM place, or a place the hero already knows by another source.
function taken(a,name){const k=key(name);
  if(ZONES.some(z=>z&&key(z)===k)||CITY.some(c=>key(c.name)===k)||LANDMARKS.some(l=>key(l.name)===k)||cryptIf(n=>key(n)===k))return 'That is already the name of a land you could not rename.';
  if((S.places||[]).some(p=>p&&p.name&&key(p.name)===k))return 'A marked place already goes by that name.';
  for(const n of Object.keys(loreOf(a).p)){if(key(n)!==k)continue;const e=loreOf(a).p[n];if(!e.mk)return 'You already know a place called '+n+'.'}
  return null}
const own=a=>{const P=loreOf(a).p;return Object.keys(P).filter(n=>P[n].mk===1)};
const findOwn=(a,t)=>{const k=key(t),P=loreOf(a).p;return own(a).find(n=>key(n)===k)||null};

// The spot: where the hero stands, or a place in sight (what): a DM marker, a landmark corner.
function spotOf(a,what){const w=clean(what,60).toLowerCase();if(!w)return {x:a.x,y:a.y};
  const m=(S.places||[]).find(p=>p&&p.name&&key(p.name)===key(w)&&dist(a,p)<=10);if(m)return {x:m.x,y:m.y};
  const l=LANDMARKS.find(x=>key(x.name)===key(w)&&dist(a,x)<=12);if(l)return {x:l.x,y:l.y+(l.r||1)+1};
  return null}

// mark {name, note?, what?}: returns {ok,...} or {error}.
export function markPlace(a,{name,note,what}){
  const nm=clean(name,MARK.NAME_MAX);
  if(bare(nm).length<MARK.NAME_MIN)return {error:'Name the place (at least '+MARK.NAME_MIN+' letters): mark {name: "Fisher\'s Ford", note: "boars at dusk"}.'};
  if(!/[a-z]/i.test(nm))return {error:'A name needs letters.'};
  if(inTown(a))return {error:'You stand in a town; its places are known to everyone. Mark a spot out in the wild.'};
  const sp=spotOf(a,what);if(!sp)return {error:'"'+clean(what,40)+'" is not in sight. Mark where you stand (no what), or a marker or landmark you can see.'};
  const old=findOwn(a,nm),bad=!old&&taken(a,nm);if(bad)return {error:bad};
  const P=loreOf(a).p,z=zoneAt(sp.x,sp.y),zn=ZONES[z]||null;let folded=null;
  if(!old&&own(a).length>=MARK.MAX){const oldest=own(a).sort((p,q)=>(P[p].at||0)-(P[q].at||0))[0];delete P[oldest];folded=oldest}
  const e={how:'own',mk:1,at:Math.round(S.gameMin),day:day(),x:Math.round(sp.x*10)/10,y:Math.round(sp.y*10)/10,zone:zn};
  const nt=clean(note,MARK.NOTE_MAX);if(nt)e.note=nt;
  if(old&&old!==nm)delete P[old];P[nm]=e;
  return {ok:true,marked:nm,at:{x:e.x,y:e.y},region:zn||'the wilds',...(nt?{note:nt}:{}),...(old?{moved:true}:{}),...(folded?{folded:folded+' (your oldest mark, forgotten to make room)'}:{}),
    tip:'places lists it; move_to, hunt {where} and lead_to take "'+nm+'". Say its name aloud and companions in earshot learn it. unmark {name} forgets it.'}}

export function unmarkPlace(a,{name}){const n=findOwn(a,name);
  if(!n){const mine=own(a);return {error:'You have no mark called "'+clean(name,40)+'".'+(mine.length?' Yours: '+mine.join(', ')+'.':' You have marked nothing yet.')}}
  delete loreOf(a).p[n];return {ok:true,unmarked:n}}

// The walkable spot of a marked or told place by name (any case, "the" optional), or null (planOne).
export function markAt(a,t){if(!a||!a.lore)return null;const k=key(t);if(!k)return null;
  for(const n of Object.keys(a.lore.p)){const e=a.lore.p[n];if(!e.mk||e.x==null||key(n)!==k)continue;return {x:e.x,y:e.y,name:n,warn:e.note?n+': '+e.note+'.':null}}
  return null}

// Words for lists: places and lore.
export const markHow=e=>e&&e.mk?(e.mk===1?'yours':'told by '+(e.src||'a companion')):null;
export function markNames(a){return a&&a.lore?Object.keys(a.lore.p).filter(n=>a.lore.p[n].mk):[]}

// Heard aloud (player.js, where a hero reads its chat): a hero who marked a place and said its name, in earshot of this one.
export function hearMarks(b,speaker,text){if(!b||!speaker||speaker===b||speaker.kind!=='hero'||!speaker.lore||!b.player)return 0;
  const t=String(text||'');if(t.length<MARK.NAME_MIN)return 0;let n=0;
  for(const nm of own(speaker)){const e=speaker.lore.p[nm];if(!new RegExp('(^|[^A-Za-z])'+reEsc(bare(nm))+'($|[^A-Za-z])','i').test(t))continue;
    const L=loreOf(b).p,mine=Object.keys(L).find(x=>key(x)===key(nm));
    if(mine&&(!L[mine].mk||L[mine].mk===1))continue; // already its own, or a known land
    L[nm]={how:'told',mk:2,src:speaker.name,at:Math.round(S.gameMin),day:day(),x:e.x,y:e.y,zone:e.zone};n++}
  return n}
