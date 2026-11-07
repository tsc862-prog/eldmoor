// World events (#10, #335, #353): the DM lever start_event runs a festival, plague, migration or invasion over a region.
// An event is the existing region condition (levers.js CONDITIONS) held for a fixed time, so the
// lever's limits, cooldown and DM log all apply and the effects stay what those hooks already do:
// quieter road encounters, merchants or pilgrims, townsfolk talk more or keep indoors. Nothing here
// touches HP, level or life, and nothing starts by itself: only a lever pull runs an event.
import {S} from './state.js';
import {ZONES,REGIONS,CITY,ZPTS} from '../world/map.js';
import {FAC} from '../data/factions.js';
import {ADVENTURES} from '../data/adventures.js';
import {dmlog} from './dmlog.js';
import {log} from './chronicle.js';
import {provide,pull} from './levers.js';

export const EVENT_DAYS=3,EVENT_MAX_SCALE=3,EVENT_COOLDOWN_DAYS=3; // the next event may start this many game days after the last one ended // days at scale 1; scale 1-3 multiplies it
export const EVENTS={
  festival:{start:z=>'A festival fills the market towns of '+ZONES[z]+'.'},
  plague:{start:z=>'A plague creeps through '+ZONES[z]+'; townsfolk keep indoors.'},
  migration:{start:z=>'The herds of '+ZONES[z]+' are on the move; packs and beasts roam the whole region.'},
  invasion:{cond:'bandits',start:z=>'Raiders pour into '+ZONES[z]+'; the roads grow dangerous.'}, // the bandits condition: more road encounters, more ambushes
};

// Adventure hooks an event posts (#10): per kind, the job templates it offers on the board of each faction's nearest
// town. A template is offered only when the region's level band reaches its minimum level, so heroes of the right level
// answer it; each faction gets its own board, so each faction's heroes respond. Tagged h.ev with the condition id.
export const EVENT_HOOKS={festival:['escort'],plague:['deliver','rescue'],migration:['clear'],invasion:['clear','rescue']};
const bandHi=z=>REGIONS[z]&&REGIONS[z].band?REGIONS[z].band[1]:99;
function townFor(f,z){const p=(ZPTS[z]||[])[0]||{x:0,y:0};let best=null,bd=1e9;
  for(const c of CITY){if(c.fac!==f)continue;const d=Math.hypot(c.gate.x-p.x,c.gate.y-p.y);if(d<bd){bd=d;best=c}}return best}
function postEventHooks(p,def,cid,ctx){const out=[],tpls=(EVENT_HOOKS[p.kind]||[]).filter(t=>ADVENTURES[t]&&ADVENTURES[t].lvl<=bandHi(p.region));
  if(!tpls.length)return out;
  FAC.forEach((_,f)=>{const c=townFor(f,p.region);if(!c)return;
    const r=pull('post_hook',{town:c.name,tpl:tpls[f%tpls.length],region:p.region,src:'dm'},{by:ctx.by||'scripted',reason:'the '+p.kind+' in '+ZONES[p.region]+' needs hands'});
    if(r.ok&&r.ret){r.ret.ev=cid;out.push({town:c.name,fac:f,hook:r.ret.id})}});
  return out}
export const eventCooling=()=>{const w=S.worldEvent;return w&&w.lastEnd!=null&&S.gameMin<w.lastEnd+EVENT_COOLDOWN_DAYS*1440?w.lastEnd+EVENT_COOLDOWN_DAYS*1440:0};

export function startEvent(p,ctx){
  const def=Object.hasOwn(EVENTS,p.kind)?EVENTS[p.kind]:undefined;if(!def)return {ok:false,effect:'unknown event kind '+p.kind+' ('+Object.keys(EVENTS).join(', ')+')'};
  if(!S.conditions)S.conditions=[];
  {const t=eventCooling();if(t)return {ok:false,effect:'the last world event ended recently; the next may start in '+Math.ceil((t-S.gameMin)/1440)+' game days'}}
  if(S.conditions.some(c=>c.z===p.region))return {ok:false,effect:ZONES[p.region]+' already has a condition'};
  const scale=Math.max(1,Math.min(EVENT_MAX_SCALE,p.scale|0||1)),until=S.gameMin+EVENT_DAYS*scale*1440;
  const c={id:++S.uid,kind:def.cond||p.kind,z:p.region,str:scale,until,lever:ctx.id};S.conditions.push(c);
  log(def.start(p.region));
  const hooks=postEventHooks(p,def,c.id,ctx);(S.worldEvent||(S.worldEvent={lastEnd:null,done:[]})).cur={id:ctx.id,cid:c.id,kind:p.kind,z:p.region,start:S.gameMin};
  return {ok:true,effect:{condition:c.id,kind:p.kind,zone:ZONES[p.region],scale,days:EVENT_DAYS*scale,hooks:hooks.length},until}}

// The event ends (the lever expires): count how its hooks went per faction in facStats (events = jobs it posted,
// eventsDone = jobs finished well), take down what nobody took, write the DM log entry, start the cooldown.
export function endEvent(rec){const w=S.worldEvent||(S.worldEvent={lastEnd:null,done:[]}),cur=w.cur&&w.cur.id===rec.id?w.cur:{id:rec.id,kind:rec.params&&rec.params.kind,z:rec.region};
  const cid=cur.cid,hs=(S.adventures||[]).filter(h=>cid!=null&&h.ev===cid),per=FAC.map(()=>({posted:0,done:0}));
  for(const h of hs){const r=per[h.fac];if(!r)continue;r.posted++;if(h.phase==='done'&&(h.outcome==='success'||h.outcome==='partial'))r.done++}
  for(const h of hs)if(h.phase==='open'){const i=S.adventures.indexOf(h);if(i>=0)S.adventures.splice(i,1)}
  per.forEach((r,f)=>{const st=S.facStats&&S.facStats[f];if(!st)return;st.events=(st.events||0)+r.posted;st.eventsDone=(st.eventsDone||0)+r.done});
  w.lastEnd=S.gameMin;delete w.cur;(w.done=w.done||[]).push({kind:cur.kind,z:cur.z,start:cur.start,end:S.gameMin,hooks:per});if(w.done.length>20)w.done.shift();
  log('The '+cur.kind+' in '+ZONES[cur.z]+' is over.');
  dmlog('event',null,['The '+cur.kind+' in '+ZONES[cur.z]+' ended: '+per.map((r,f)=>FAC[f].name+' '+r.done+'/'+r.posted+' jobs done').join(', ')],{kind:cur.kind,region:ZONES[cur.z],factions:per})}

provide('startEvent',startEvent);provide('endEvent',endEvent);
