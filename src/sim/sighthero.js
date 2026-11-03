// Noticing heroes in sight (issue #570). Owned by ai-designer. DOM-free, no RNG, agent-played heroes only.
//   sight event   a company member, a hero this one follows or has spoken with, or the hero its stated aim names (a.intent)
//                 comes into sight: "You see Thessin to the east, about 8 tiles off". Companions and the sought hero are
//                 urgent (wake at once); others are soft news. Once per seen hero per SEE.HOUR game minutes, and only on
//                 coming into sight (a companion walking beside you is not news). Not inside a town.
//   stop on sight an autopilot walk toward an aim that seeks a hero (find / meet / look for) stops when that hero is seen;
//                 intentPilot (sim/player.js) then holds where the hero stands until the agent decides.
//   in sight      sightLine(a): "Thessin (E, 8 tiles), Branas (N, 12)" for companions in sight beyond earshot (turn header).
//   looking for   lookingFor(a): the hero a seeking aim names, for the purpose line.
// Reads and a few plain fields on the agent hero (a.sightNow, a.sightAt); the seeded scripted world never comes here.
// Privacy (#123): only heroes within the viewer's sight are named with a place; the aim's own words name the rest.
import {S} from './state.js';
import {CITY,dist,zoneAt} from '../world/map.js';
import {sightMul} from './weather.js';
import {nearHeroes} from './spatial.js';
import {ev} from './notify.js';
import {companyOf} from './company.js';

export const SEE={SIGHT:12,HOUR:60,EAR:7,MAX:4}; // SIGHT = FOLLOW.SIGHT; EAR = chat.js HEAR (not imported: cycles)
const SEEK=/\b(find|finding|meet|meeting|look(?:ing)?\s+for|seek|seeking|search(?:ing)?\s+for|rejoin|regroup|catch(?:ing)?\s+up|reach|locate|join)\b/i;
const alive=b=>!!b&&b.state!=='dead'&&!b.hidden;
const inTown=p=>CITY.some(c=>p.x>=c.x0-.5&&p.x<=c.x1+1.5&&p.y>=c.y0-.5&&p.y<=c.y1+1.5);
export const sightRange=a=>SEE.SIGHT*sightMul(zoneAt(a.x,a.y));
const DIRS=['E','NE','N','NW','W','SW','S','SE'],WORD={E:'east',NE:'north-east',N:'north',NW:'north-west',W:'west',SW:'south-west',S:'south',SE:'south-east'};
export const compass=(a,b)=>DIRS[(Math.round(Math.atan2(-(b.y-a.y),b.x-a.x)/(Math.PI/4))+8)%8]; // north is up (y grows south)
const first=b=>String(b.name).toLowerCase().split(/\s+/)[0];
const names=(goal,b)=>{const g=String(goal||'').toLowerCase(),n=String(b.name).toLowerCase(),f=first(b);
  return g.includes(n)||new RegExp('(^|[^a-z])'+f.replace(/[^a-z]/g,'')+'($|[^a-z])').test(g)};
const liveAim=a=>a&&a.player&&a.intent&&!a.intent.done?a.intent:null;
const mateIds=a=>{const C=companyOf(a);return C?C.ids.filter(i=>i!==a.id):[]};
const heardBoth=(a,b)=>!!((a.talkHeard||{})[b.id]&&(b.talkHeard||{})[a.id]);

// The heroes in sight now (not hidden, not dead), nearest first.
export function inSight(a){const R=sightRange(a);return nearHeroes(a.x,a.y,R).filter(b=>b!==a&&alive(b)&&dist(a,b)<=R).sort((x,y)=>dist(a,x)-dist(a,y)||x.id-y.id)}
// Does the stated aim name b / seek b?
export const aimNames=(a,b)=>{const I=liveAim(a);return !!(I&&names(I.goal,b))};
export const aimSeeks=(a,b)=>{const I=liveAim(a);return !!(I&&SEEK.test(I.goal)&&names(I.goal,b))};
// The hero a seeking aim names (any living hero, by the agent's own words); null when it seeks none. For the purpose line.
export function lookingFor(a){const I=liveAim(a);if(!I||!SEEK.test(I.goal))return null;
  return S.agents.find(b=>b!==a&&b.kind==='hero'&&b.state!=='dead'&&names(I.goal,b))||null}

const followId=a=>{const c=a.pq&&a.pq[0];return c&&c.kind==='follow'?c.id:(a.playOrder&&a.playOrder.kind==='follow'?a.playOrder.id:null)};
// 'sought' | 'companion' | 'met' | null: why b matters to a.
export function whyMatters(a,b){if(aimNames(a,b))return 'sought';
  if(mateIds(a).includes(b.id)||followId(a)===b.id)return 'companion';
  if(heardBoth(a,b))return 'met';return null}

const tiles=d=>{const n=Math.max(1,Math.round(d));return n+(n===1?' tile':' tiles')};

// Each step of an agent hero (playerUpd). Writes events and, for a seeker, stops its autopilot walk.
export function noticeHeroes(a){if(!a.player||a.state==='dead'||a.state==='ghost'||a.hidden)return;
  const seen=inSight(a),ids=seen.map(b=>b.id),prev=a.sightNow;a.sightNow=ids;
  if(!prev)return; // the first look sets the baseline: nobody "comes into sight" at once
  const at=a.sightAt||(a.sightAt={});
  for(const b of seen){const why=whyMatters(a,b);if(!why)continue;
    if(aimSeeks(a,b))stopSeeking(a,b);
    if(prev.includes(b.id)||inTown(a))continue;
    if(S.gameMin-(at[b.id]??-1e9)<SEE.HOUR)continue;
    at[b.id]=Math.round(S.gameMin);
    const d=dist(a,b),dir=WORD[compass(a,b)];
    ev(a,'You see '+b.name+' to the '+dir+', about '+tiles(d)+' off'+(why==='sought'?' (the one you were looking for)':why==='companion'?' (a companion)':'')+'.',why==='met'?false:2)}}

// A seeker's autopilot walk ends on sight; intentPilot holds it there (I.sighted) until the agent acts.
function stopSeeking(a,b){const I=a.intent,c=a.pq&&a.pq[0];
  if(!a.playIdle||!c||c.kind!=='move'||c.flee)return;
  I.sighted={id:b.id,name:b.name,at:Math.round(S.gameMin)};
  a.pq=[];a.moving=false;a.dest=null;if(Math.abs(b.x-a.x)>.05)a.face=b.x>a.x?1:-1; // turns toward them
  if(a.state==='travel')a.state=inTown(a)?'town':'hunt'}
// intentPilot asks: has the seeker already seen who it seeks (within the last SEE.HOLD minutes)?
export const sighted=a=>{const I=liveAim(a),s=I&&I.sighted;return s&&S.gameMin-s.at<240?s:null};

// Turn header: companions (and the sought hero) in sight but beyond earshot. null when none.
export function sightLine(a){if(!a||!a.player||a.state==='dead'||a.state==='ghost')return null;
  const L=inSight(a).filter(b=>dist(a,b)>SEE.EAR&&whyMatters(a,b)&&whyMatters(a,b)!=='met');if(!L.length)return null;
  const s=L.slice(0,SEE.MAX).map(b=>b.name+' ('+compass(a,b)+', '+Math.round(dist(a,b))+(dist(a,b)<2?' tile':' tiles')+')').join(', ');
  return s+(L.length>SEE.MAX?' and '+(L.length-SEE.MAX)+' more':'')}
