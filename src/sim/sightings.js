// Sightings and notices (#446, epic #402 slice 9). Owned by ai-designer. DOM-free, no RNG.
//   sighting  an agent hero passing its town gate or setting out for a region leaves one line of rumour
//             {id, hero, name, cls, fac, town, at, bound}; the innkeeper and the gate (list_jobs) repeat it for SIGHT.DAYS
//             game days. Only agent-played heroes (a.player) write one, so the scripted world is unchanged.
//   notice    post_notice pins one text (<=120 characters) to the poster's town board for SIGHT.NOTICE_DAYS; a reader
//             learns the poster's name, class and town and the text, nothing else (#123: no position, HP or mind).
//   met       the heroes a hero may send a courier to by name: its company, and anyone it has spoken with in earshot.
//   lastKnown a.knownAt[id] = {x,y,at} written where two heroes spoke; the courier fee is priced from that place, never
//             from where the other hero is now.
// Plain data on S.sightings and S.notices (created on first use, saved with the world).
import {S,sameSide} from './state.js';
import {homeOf} from '../data/races.js';

export const SIGHT={DAYS:3,MAX:24,NOTICE_DAYS:2,NOTICE_MAX:30,TEXT:120,LINES:3};
const clean=(s,n)=>String(s==null?'':s).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,n);
const living=a=>a&&a.state!=='dead';
const ago=m=>{const h=Math.round((S.gameMin-m)/60);return h<2?'a little while ago':h<36?'about '+h+' hours ago':'about '+Math.round(h/24)+' days ago'};

export function writeSighting(a,bound,town){if(!a||!a.player||a.kind!=='hero')return null;
  const L=S.sightings||(S.sightings=[]),t=town||homeOf(a).name,b=clean(bound,40);
  const i=L.findIndex(s=>s.hero===a.id);if(i>=0)L.splice(i,1);
  const s={id:(S.sightSeq=(S.sightSeq||0)+1),hero:a.id,name:a.name,cls:a.cls,fac:a.fac,town:t,at:Math.round(S.gameMin),bound:b};
  L.unshift(s);if(L.length>SIGHT.MAX)L.length=SIGHT.MAX;return s}
const live=s=>S.gameMin-s.at<=SIGHT.DAYS*1440;
// What the reader hears at a town: other heroes of its faction seen at that gate, newest first (text only, no places but the region named).
export function sightingLines(reader,town){
  return (S.sightings||[]).filter(s=>live(s)&&sameSide(s,reader)&&s.hero!==reader.id&&(!town||s.town===town)).slice(0,SIGHT.LINES)
    .map(s=>({hero:s.name,text:'A '+s.cls+' called '+s.name+' passed through '+ago(s.at)+(s.bound?', bound for '+s.bound:'')+'.',bound:s.bound||undefined}))}

// ---- notices ----
const liveN=n=>S.gameMin<n.until;
export function noticeOf(a){return (S.notices||[]).find(n=>n.by===a.id&&liveN(n))||null}
export function postNotice(a,text,town){const t=clean(text,SIGHT.TEXT+1);
  if(!t)return {error:'Write the notice: what you seek, in a few words.'};
  if(t.length>SIGHT.TEXT)return {error:'Too long: a notice is '+SIGHT.TEXT+' characters at most.'};
  if(noticeOf(a))return {error:'Your notice is still up on the board; wait for it to lapse.'};
  const L=S.notices||(S.notices=[]);for(let i=L.length-1;i>=0;i--)if(!liveN(L[i]))L.splice(i,1);
  const n={id:(S.noticeSeq=(S.noticeSeq||0)+1),by:a.id,byName:a.name,cls:a.cls,fac:a.fac,town,text:t,at:Math.round(S.gameMin),until:Math.round(S.gameMin+SIGHT.NOTICE_DAYS*1440)};
  L.unshift(n);if(L.length>SIGHT.NOTICE_MAX)L.length=SIGHT.NOTICE_MAX;return n}
export function noticesAt(reader,town){
  return (S.notices||[]).filter(n=>liveN(n)&&n.town===town&&sameSide(n,reader)&&n.by!==reader.id)
    .map(n=>({from:'A '+n.cls+' called '+n.byName+' of '+n.town,notice:n.text,posted:ago(n.at),poster:n.byName}))}

const byId=id=>S.agents.find(x=>x.id===id)||null;
// both spoke in each other's hearing (same rule as talk.js metIds, kept here so this module imports no sim logic)
const metIds=a=>Object.keys(a.talkHeard||{}).map(Number).filter(id=>{const b=byId(id);return b&&b.state!=='dead'&&(b.talkHeard||{})[a.id]});
// ---- who a hero has met (courier by name) ----
export function noteKnownAt(a,b){if(!a||!b)return;(a.knownAt||(a.knownAt={}))[b.id]={x:Math.round(b.x*10)/10,y:Math.round(b.y*10)/10,at:Math.round(S.gameMin)}}
export function metHero(a,key){const k=String(key==null?'':key).trim().toLowerCase();if(!k)return null;
  const pool=metIds(a).map(byId).filter(Boolean);
  return pool.find(b=>b!==a&&(b.name.toLowerCase()===k||String(b.id)===k))||null}
export const knownPlace=(a,b)=>(a.knownAt&&a.knownAt[b.id])||null;
