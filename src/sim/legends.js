// Legends hall (issue #17): the greatest heroes of the whole run, living and dead.
// S.legends = {next, mark, tally, list}: list holds at most LEG_CAP plain-data entries ranked
// by score. Pure bookkeeping, no random numbers: legendsTick(dt) runs once per game hour,
// scores every hero, and notices deaths by reading the hero's own state and S.fallen, so
// heroes.js is untouched. Entries are ids and strings only, so they save as they are.
import {S} from './state.js';
import {ZONES,zoneAt} from '../world/map.js';
import {raceOf} from '../data/races.js';
import {wasFellow} from './fellowship.js';

export const LEG_CAP=30,LEG_MIN=40,HOUR=60;
const rank=(a,b)=>b.score-a.score||b.lvl-a.lvl||a.id-b.id;
export const scoreOf=c=>Math.round(c.lvl*10+c.epics*6+c.elite*8+c.oaths*10+c.boss*40+c.crypt*25+c.honor*1.5);

// Counts that no hero field keeps: boss and crypt wins come from the hero's own log, oaths from the timeline.
function tallies(){const L=S.legends,t=L.tally;
  for(const e of S.timeline||[]){if(e.gameMin<=L.mark)break;
    if(e.kind!=='oath')continue;const h=e.parts.find(p=>p&&p.kind==='hero');
    if(h)(t[h.id]||(t[h.id]={oaths:0})).oaths++}}
function histCounts(a){let boss=0,crypt=0;
  for(const h of a.history||[]){const x=h.text||'';if(/^Slew /.test(x))boss++;else if(/^Cleared /.test(x))crypt++}return {boss,crypt}}

function highlights(c,a){const h=[];
  if(c.boss)h.push('Slew Kragmaw'+(c.boss>1?' x'+c.boss:''));
  if(c.crypt)h.push('Cleared the Crypt'+(c.crypt>1?' x'+c.crypt:''));
  if(c.elite)h.push(c.elite+' elite kill'+(c.elite>1?'s':''));
  if(c.oaths)h.push(c.oaths+' high oath'+(c.oaths>1?'s':'')+' kept');
  if(c.epics)h.push(c.epics+' epic'+(c.epics>1?'s':''));
  if(a.kills>=50)h.push(a.kills+' kills');
  if(c.honor>=10)h.push(c.honor+' honor');
  return h.slice(0,4)}

export function legendsTick(dt){
  const L=S.legends||(S.legends={next:0,mark:S.gameMin,tally:{},list:[]});
  if(S.gameMin<L.next)return;L.next=S.gameMin+HOUR;
  tallies();L.mark=S.gameMin;
  const byId=new Map(L.list.map(e=>[e.id,e]));
  for(const a of S.agents){if(a.kind!=='hero')continue;
    const e=byId.get(a.id);if(e&&!e.alive)continue; // a settled death is final
    const t=L.tally[a.id]||{oaths:0},hc=histCounts(a),prev=e?e.c:{boss:0,crypt:0,epics:0};
    const c={lvl:Math.max(a.lvl,e?e.lvl:0),epics:Math.max(a.epics.length,prev.epics),elite:a.eliteKills||0,oaths:t.oaths,
      boss:Math.max(hc.boss,prev.boss),crypt:Math.max(hc.crypt,prev.crypt),honor:a.honor||0};
    const score=scoreOf(c);if(!e&&score<LEG_MIN)continue;
    const o=e||{id:a.id,name:a.name};
    Object.assign(o,{name:a.name,people:raceOf(a).name,cls:a.cls,fac:a.fac,tag:a.guild?a.guild.tag:null,lvl:c.lvl,score,c,hl:highlights(c,a),
      fel:!!wasFellow(a)||!!(e&&e.fel),alive:a.state!=='dead'});
    if(a.state==='dead'){o.cause=a.cause||'fallen';o.diedAt=a.diedAt||'';o.diedDay=Math.floor(S.gameMin/1440)+1;
      const z=zoneAt(a.x,a.y),lost=/^lost in (.+)$/.exec(o.cause);o.place=lost?lost[1]:(z>=0&&ZONES[z])||'the wilds'}
    if(!e){L.list.push(o);byId.set(o.id,o)}}
  // A living entry whose hero was recycled while dead: recover the end of the story from the graveyard.
  for(const e of L.list){if(!e.alive||S.agents.some(a=>a.id===e.id))continue;
    const f=S.fallen.find(x=>x.name===e.name&&x.fac===e.fac);
    e.alive=false;e.cause=f?f.cause:'fallen';e.diedAt=f?f.t:'';e.place=e.place||'the wilds'}
  L.list.sort(rank);if(L.list.length>LEG_CAP)L.list.length=LEG_CAP;
  const keep=new Set(S.agents.map(a=>a.id));for(const id in L.tally)if(!keep.has(+id)&&!L.list.some(e=>e.id==id))delete L.tally[id]}
