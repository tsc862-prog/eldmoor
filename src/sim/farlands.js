// What a hero knows of other maps (#1013 slice 5). Owned by brain-builder. DOM-free, no dice, no write outside the hero's own lore.
// A far map is a place like any other: known only when seen, walked or heard. The gate's word (list_jobs), a townsperson asked (talk), a
// companion's line, a rumour the DM seeds (about) all put names on a.lore.p; nothing here reads what the hero could not know, and the far
// map's own words stay the DM's until someone tells them.
//   roadsSeen(a, town)  look: the roads out near the hero (in town, the ones it knows), with what is said of them
//   gateRoads(a)        list_jobs: the same for every road, and it teaches: the road, the land past it, its first town
//   roadsKnown(a, from) places: every road this hero knows, with its way
//   farWay(a, t)        move_to and lead_to: the road these words lead to, in words, or the refusal
//   farAnswer(a, t)     talk: a townsperson's answer about the roads and the lands past them
//   boundWords(a, name) the leader's word after a crossing: where the place it set out for lies now
// Every one answers nothing on a map with no exits, so a single-map world is untouched.
import {MAP_ID,EXITS,CITY,ZONES,dist} from '../world/map.js';
import {MAPS} from '../world/spec.js';
import {exitOpen,mapName,mapBand,namesOf,roadOf,hopsTo,roadsFrom,farNamed,spotHere} from './atlas.js';
import {roadWords} from './roads.js';
import {knowsPlace,learnPlace,heardOf} from './lore.js';

export const FAR={SEE:20,BEYOND:6};
const COMPASS=['east','southeast','south','southwest','west','northwest','north','northeast'];
const way=(p,e)=>{const dx=e.x-p.x,dy=e.y-p.y,d=Math.hypot(dx,dy);return d<1.5?'here':COMPASS[((Math.round(Math.atan2(dy,dx)/(Math.PI/4))%8)+8)%8]+', '+Math.round(d)+' tiles'};
const knowing=a=>n=>knowsPlace(a,n);
const cap=t=>t.charAt(0).toUpperCase()+t.slice(1);
const list=L=>L.length<2?L.join(''):L.slice(0,-1).join(', ')+' and '+L[L.length-1];
// The gate's feel for a land, by the hero's level (as jobRumour does a region).
function bandWord(a,id){const b=mapBand(id);if(!b)return null;return b[0]>a.lvl+3?'no road for green blades, they say':b[0]>a.lvl+1?'they say it will test you':b[1]<a.lvl-3?'they call it easy going':'they call it an honest road'}
const walked=(a,id)=>{const p=a.lore&&a.lore.p[mapName(id)];return !!p&&p.how!=='told'};

// One road as this hero knows it. What lies past it is what the hero has heard of, and no more.
function roadRow(a,e,from){const r={road:e.name,...(from?{way:way(from,e)}:{})};
  if(!exitOpen(e))return {...r,open:false,word:'toward '+e.to.heard+'. Nobody here has walked it, and the way is not yet open'};
  const id=e.to.map,k=knowing(a),heard=namesOf(id).filter(k);
  if(!heard.length)return {...r,word:'nobody has told you where it goes; the gate will know (list_jobs)'};
  const land=knowsPlace(a,mapName(id))?mapName(id):heard[0],more=heard.filter(n=>n!==land).slice(0,FAR.BEYOND);
  const on=[...roadsFrom(x=>namesOf(x).some(k)).entries()].filter(([m,h])=>h.length>1&&h[0].exit===e.id&&namesOf(m).some(k)).map(([m])=>knowsPlace(a,mapName(m))?mapName(m):namesOf(m).find(k));
  return {...r,leads_to:land,...(more.length?{beyond:more}:{}),...(on.length?{then:on}:{}),word:walked(a,id)?'you have walked it':bandWord(a,id)||'they say it goes on'}}

export function roadsSeen(a,town){if(!EXITS.length)return [];const L=EXITS.filter(e=>town?knowsPlace(a,e.name):dist(a,e)<=FAR.SEE);
  return L.map(e=>{learnPlace(a,e.name,'seen');return roadRow(a,e,town?null:a)})}
export function gateRoads(a){if(!EXITS.length)return [];
  return EXITS.map(e=>{const g='the gate captain';heardOf(a,{kind:'far',name:e.name},g);
    if(exitOpen(e)){const M=MAPS[e.to.map];heardOf(a,{kind:'far',name:M.name},g);if(M.towns&&M.towns[0])heardOf(a,{kind:'far',name:M.towns[0].name},g)}
    return roadRow(a,e)})}
export function roadsKnown(a,from=a){return EXITS.filter(e=>knowsPlace(a,e.name)).map(e=>roadRow(a,e,from))}

// A mark of the hero's own (or told) on another land: walked to by the road that goes there.
function farMark(a,t){const P=a.lore&&a.lore.p;if(!P)return null;const k=String(t).toLowerCase().replace(/^the\s+/,'');
  for(const n of Object.keys(P)){const e=P[n];if(e.map&&!spotHere(e)&&(e.mk||e.dm!=null)&&n.toLowerCase().replace(/^the\s+/,'')===k){const hops=hopsTo(e.map,knowing(a));return hops?{e:EXITS.find(x=>x.id===hops[0].exit),bound:n,map:e.map,hops}:{lost:{map:e.map,name:n}}}}
  return null}
// In words: where a place lies, by the roads the hero knows.
function wayWords(w){const h=w.hops,land=mapName(w.map);
  return w.bound+(w.bound===land?' lies':' lies in '+land)+(h.length<2?', past '+h[0].road:', '+h.length+' lands on: past '+h[0].road+', then through '+list(h.slice(0,-1).map(x=>mapName(x.to))))+'.'}
// What these words mean for a walk off this map: null (nothing of the kind), {error}, or {e, bound?, note}.
export function farWay(a,t){if(!EXITS.length)return null;const w=roadOf(t,knowing(a))||farMark(a,t);if(!w)return null;
  if(w.lost)return {error:'You have heard of '+w.lost.name+', but not how to get there: no road you know leads that way. Ask at the gate (list_jobs) or in the inn, or walk on and learn the lands between.'};
  if(!exitOpen(w.e))return null;
  return {e:w.e,bound:w.bound||null,note:(w.bound?wayWords(w)+' ':'')+'That road leaves this land. When your leader reaches it with everyone together, the company decides at the table.'}}

// A townsperson asked about the roads, or a place past them. The hero learns what it is told (the caller's hear does the rest).
const ROADQ=/\b(roads?)\b.*\b(out|leads?|goes?|beyond|where|past)\b|\b(leads?|goes?|beyond|past|out)\b.*\broads?\b|\b(other|far|next) (lands?|country|countries)\b|\bbeyond (this|the) (land|valley|hills)\b/i;
export function farAnswer(a,t){if(!EXITS.length)return null;const f=farNamed(t,()=>true);
  if(f){const h=hopsTo(f.map);if(!h)return null;heardOf(a,{kind:'far',name:f.name},'someone in town');const land=mapName(f.map);heardOf(a,{kind:'far',name:land},'someone in town');
    return f.name+(f.name===land?' lies':' lies in '+land)+(h.length<2?', past '+h[0].road:', '+h.length+' lands on, past '+h[0].road)+'.'}
  if(!ROADQ.test(t))return null;
  return EXITS.map(e=>{heardOf(a,{kind:'far',name:e.name},'someone in town');if(!exitOpen(e))return roadWords(e);const n=mapName(e.to.map);heardOf(a,{kind:'far',name:n},'someone in town');return cap(e.name)+' goes on to '+n+'.'}).join(' ')}

// The leader's word once the road is behind it: where the place it set out for lies from here.
export function boundWords(a,name){if(!name)return '';if(CITY.some(c=>c.name===name)||ZONES.includes(name)||namesOf(MAP_ID).includes(name))return ' '+name+', which you set out for, is in this land.';
  const w=roadOf(name,knowing(a));return w&&w.bound?' You set out for '+wayWords(w):''}
