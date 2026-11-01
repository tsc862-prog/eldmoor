// The brain layer (issue #40): decision points where a hero's choice can come from a
// policy other than the scripted state machine. Owned by brain-builder.
//
// Decision points (all async-capable, none per tick):
//   townPlan(a)            zone for the next trip, and whether to answer a Sunken Crypt call
//   fightOrFlee(a,m)       once HP crosses 50% in a fight with a mob 1+ levels above
//   say(a,trigger,ctx)     one in-voice line instead of the table line (chat.js)
// The scripted policy is today's logic. A hero with a.brain asks the relay
// (scripts/relay.mjs, 127.0.0.1:8787) fire-and-forget; the answer is validated against
// the options the sim offered and parked in a.brainPlan (or the line cache), and is
// applied at the NEXT decision point. The sim never awaits a model: late, malformed or
// illegal answers are dropped and the scripted choice acts. Heroes with no brain, and
// the headless sim, take the scripted path with no extra RNG and no network.
// Nothing here rolls a random number; the only state on the hero is the plain data
// a.brain (flag), a.brainPlan ({town,fight}) and S.brainHeroes (ids), all saved as-is.
// S.brainOn === false is the global kill switch (undefined means on).
import {ZONES,zoneFor,zoneAt,dist,CRYPT} from '../world/map.js';
import {FAC} from '../data/factions.js';
import {SLOTS} from '../data/items.js';
import {MOBS} from '../data/mobs.js';
import {raceOf} from '../data/races.js';
import {S} from './state.js';
import {log} from './chronicle.js';
import {pop} from './effects.js';
import {maxHp,goHome} from './heroes.js';
import {gearScore} from './gear.js';
import {nearHeroes,nearMobs} from './spatial.js';
import {friendsOf} from './bonds.js';
import {partyMates} from './party.js';
import {weatherName} from './weather.js';

export const CFG={url:'http://127.0.0.1:8787/decide',timeoutMs:3000,offlineSec:60,
  planTtl:900,fightTtl:20,lineTtl:1800,sayGap:25,maxPerHour:240,quietMin:60,sight:12};
// Triggers (data/barks.js) that may use a model line; idle and banter are left to the tables.
export const SAY_TRIGGERS={levelup:1,epic:1,kill:1,mourn:1,duel:1,spot:1,quest:1,party:1,depart:1,flee:1};

// ---- the scripted policy: today's behaviour, as an object so a policy is swappable ----
export const SCRIPTED={
  townPlan:a=>({zone:zoneFor(a.lvl),crypt:true}),
  fightOrFlee:()=>'fight',
  say:()=>null};

// ---- transient (never saved) runtime state ----
let clk=0;                                   // sim seconds, advanced by brainTick
const busy=new Set(),offline=new Map(),lines=new Map(),asked=new Map(),sent=new Map(),lastSay=new Map();
let lastQuiet=-1e9,fetchOverride=null,acc=0;
export const stats={sent:0,applied:{townPlan:0,fightOrFlee:0,say:0},rejected:0,dropped:0,timeouts:0,failures:0,fallback:0,lastZone:null};
export const rejections=[];
export const brainClock=()=>clk;
export function resetBrain(){clk=0;acc=0;busy.clear();offline.clear();lines.clear();asked.clear();sent.clear();lastSay.clear();lastQuiet=-1e9;
  stats.sent=stats.rejected=stats.dropped=stats.timeouts=stats.failures=stats.fallback=0;
  stats.applied={townPlan:0,fightOrFlee:0,say:0};stats.lastZone=null;rejections.length=0}
export const setFetch=f=>{fetchOverride=f}; // tests only

// ---- who is AI-played ----
export function enableBrain(a){if(!a||a.kind!=='hero'||a.state==='dead')return false;
  a.brain=true;const l=S.brainHeroes||(S.brainHeroes=[]);if(!l.includes(a.id))l.push(a.id);return true}
export function disableBrain(a){if(!a)return;delete a.brain;delete a.brainPlan;lines.delete(a.id);offline.delete(a.id);
  if(S.brainHeroes)S.brainHeroes=S.brainHeroes.filter(i=>i!==a.id)}
export const brainStatus=a=>!a||!a.brain?'off':offline.get(a.id)>clk?'offline':'on';

// ---- snapshot: what the hero knows, compactly (target under ~600 tokens) ----
const pct=(h,m)=>Math.max(0,Math.round(h/m*100));
const dayPart=()=>{const h=(S.gameMin/60)%24;return h<5||h>=21?'night':h<8?'dawn':h<18?'day':'dusk'};
const clip=(s,n)=>String(s==null?'':s).slice(0,n);
export function legalZones(a){const z=zoneFor(a.lvl),out=[];if(z>0)out.push(z-1);out.push(z);return out}
export function snapshotFor(a,kind,extra={}){
  const mh=maxHp(a),z=zoneAt(a.x,a.y),R=CFG.sight;
  let top=null;for(const k of SLOTS){const it=a.slots&&a.slots[k];if(it&&(!top||it.ilvl>top.ilvl))top=it}
  const q=a.quest;
  const s={fac:FAC[a.fac].name,name:a.name,race:raceOf(a).name,cls:a.cls,lvl:a.lvl,hp:pct(a.hp,mh),gold:a.gold,
    gear:Math.round(gearScore(a)*10)/10,best:top?clip(top.name,40)+' ilvl '+top.ilvl:'none',
    traits:(a.traits||[]).join(', '),origin:clip(a.origin,160),
    goal:a.goal?clip(a.goal.text,100)+' ('+a.goal.progress+'/'+a.goal.need+')':'none',
    quest:q?(MOBS[q.type].q||q.type)+' '+q.have+'/'+q.need:'none',
    where:ZONES[z]||'the road',weather:weatherName(z),time:dayPart()};
  const mates=partyMates(a);
  if(mates.length)s.party=mates.map(b=>b.name+' '+b.cls+' L'+b.lvl+(dist(a,b)<=R?' hp'+pct(b.hp,maxHp(b))+'%':''));
  const th=nearMobs(a.x,a.y,10).sort((x,y)=>y.lvl-x.lvl).slice(0,4).map(m=>(m.elite?m.name:MOBS[m.type].name)+' L'+m.lvl);
  if(th.length)s.threats=th;
  const foes=nearHeroes(a.x,a.y,R,b=>b.fac!==a.fac&&b.state!=='dead'&&!b.hidden).slice(0,3).map(b=>b.name+' '+b.cls+' L'+b.lvl);
  if(foes.length)s.foes=foes;
  const fr=friendsOf(a).slice(0,3).map(b=>b.name);if(fr.length)s.friends=fr;
  const nm=Object.keys(a.nemesis||{}).map(id=>S.agents.find(x=>x.id==id)).filter(x=>x&&x.state!=='dead').slice(0,3).map(x=>x.name);
  if(nm.length)s.nemesis=nm;
  const ch=(a.chat||[]).slice(-5).map(e=>clip(e.from&&e.from.name,16)+': '+clip(e.text,80));if(ch.length)s.chat=ch;
  const hi=(a.history||[]).slice(-3).map(e=>clip(e.text,90));if(hi.length)s.history=hi;
  s.kind=kind;
  if(kind==='townPlan'){s.options=legalZones(a).map(i=>ZONES[i]);s.cryptOpen=a.lvl>=7}
  else if(kind==='fightOrFlee'){const m=extra.mob;s.options=['fight','flee'];s.foe=m?(m.elite?m.name:MOBS[m.type].name)+' L'+m.lvl+' hp'+pct(m.hp,m.maxhp)+'%':'?'}
  else if(kind==='say'){s.trigger=extra.trigger;s.ctx=extra.ctx||{}}
  return s}

// ---- relay client ----
const dim=t=>({t,c:'dm'});
function quiet(a){ // one dim line per game hour at most
  if(S.gameMin-lastQuiet<CFG.quietMin)return;lastQuiet=S.gameMin;log(a,dim('’s thoughts go quiet.'))}
function failed(a,timeout){stats.failures++;if(timeout)stats.timeouts++;offline.set(a.id,clk+CFG.offlineSec);quiet(a)}
const budgetOk=id=>{const now=Date.now(),l=(sent.get(id)||[]).filter(t=>now-t<3.6e6);sent.set(id,l);return l.length<CFG.maxPerHour};
const canAsk=a=>(fetchOverride||typeof fetch==='function')&&S.brainOn!==false&&a&&a.brain&&a.state!=='dead'&&!(offline.get(a.id)>clk)&&budgetOk(a.id);
function reject(a,kind,why,raw){stats.rejected++;if(rejections.length>=50)rejections.shift();
  rejections.push({kind,hero:a.name,why,raw:clip(JSON.stringify(raw),120)})}

// Fire-and-forget. onOk(res) runs when a well-formed JSON object came back in time; it only
// parks data (a.brainPlan or the line cache) and never touches the running simulation.
function ask(a,kind,extra,onOk){
  const key=a.id+':'+kind;if(busy.has(key)||!canAsk(a))return false;
  let body;try{body=JSON.stringify({kind,snapshot:snapshotFor(a,kind,extra)})}catch(e){return false}
  busy.add(key);stats.sent++;
  let l=sent.get(a.id);if(!l)sent.set(a.id,l=[]);l.push(Date.now());
  const t0=clk,ac=typeof AbortController==='function'?new AbortController():null;
  let over=false,timer=null;
  const finish=()=>{over=true;clearTimeout(timer);busy.delete(key)};
  timer=setTimeout(()=>{if(over)return;finish();failed(a,true);if(ac)ac.abort()},CFG.timeoutMs);
  try{(fetchOverride||fetch)(CFG.url,{method:'POST',headers:{'content-type':'application/json'},body,signal:ac&&ac.signal})
    .then(r=>r.json().then(j=>({ok:r.ok,j})))
    .then(({ok,j})=>{if(over)return;finish();
      if(!ok||!j||typeof j!=='object'||j.error){failed(a,false);return}
      if(clk-t0>CFG.planTtl||a.state==='dead'||!a.brain){stats.dropped++;return}
      try{onOk(j)}catch(e){stats.dropped++}})
    .catch(()=>{if(over)return;finish();failed(a,false)})}
  catch(e){finish();failed(a,false);return false}
  return true}

// Clean a model line: one short sentence in the fiction, or null.
export function cleanLine(s){if(typeof s!=='string')return null;
  s=s.replace(/[\u0000-\u001f<>]/g,' ').replace(/\s+/g,' ').trim().replace(/^["“]+|["”]+$/g,'');
  if(s.length<3||s.length>100)return null;
  if(/\b(AI|LLM|Claude|Anthropic|language model|prompt|simulation|player)\b/i.test(s))return null;return s}

// ---- decision point: townPlan ----
// Called at the town gate (heroes.js step 2). Returns the zone to head for; with no fresh,
// legal plan that is exactly zoneFor(a.lvl), the scripted answer. Plans are requested by
// brainTick while the hero is still in town so one is usually parked by departure.
export function townZone(a){const dflt=SCRIPTED.townPlan(a).zone;if(!a.brain||S.brainOn===false)return dflt;
  const p=a.brainPlan&&a.brainPlan.town;
  if(p&&!p.used&&p.t<=clk&&clk-p.t<=CFG.planTtl){p.used=1;const ix=legalZones(a).find(i=>ZONES[i]===p.choice);
    if(ix!==undefined){stats.applied.townPlan++;stats.lastZone={id:a.id,zone:ix};return ix}reject(a,'townPlan','illegal at apply',p.choice)}
  stats.fallback++;return dflt}
// Whether a hero would answer a Sunken Crypt call; scripted heroes always do.
export function brainOk(a,what){if(!a.brain||S.brainOn===false||what!=='crypt')return true;
  const p=a.brainPlan&&a.brainPlan.town;return !(p&&p.t<=clk&&clk-p.t<=CFG.planTtl&&p.crypt===false)}
function askTown(a){if(legalZones(a).length<2&&a.lvl<7)return;
  ask(a,'townPlan',{},j=>{const names=legalZones(a).map(i=>ZONES[i]);
    if(typeof j.choice!=='string'||!names.includes(j.choice)||typeof j.crypt!=='boolean'){reject(a,'townPlan','not in options',j);return}
    (a.brainPlan||(a.brainPlan={})).town={choice:j.choice,crypt:j.crypt,t:clk}})}

// ---- decision point: fightOrFlee ----
// Called every fight tick (heroes.js fight case). Asks once when HP first drops under 50%
// against a mob 1+ levels above; an arriving 'flee' is applied on a later tick if the same
// fight is still on. Scripted heroes return at the first test.
export function brainFight(a,m,mh){if(!a.brain||S.brainOn===false||!m)return false;
  const f=a.brainPlan&&a.brainPlan.fight;
  if(f&&f.mob===m.id&&!f.done&&f.t<=clk&&clk-f.t<=CFG.fightTtl){f.done=1;
    if(f.choice==='flee'&&a.state==='fight'){stats.applied.fightOrFlee++;m.target=null;goHome(a);pop(a.x,a.y-.8,'FLEE','#ffb060');return true}return false}
  if(a.hp<mh*.5&&m.lvl>=a.lvl+1&&asked.get(a.id)!==m.id){asked.set(a.id,m.id);const id=m.id;
    ask(a,'fightOrFlee',{mob:m},j=>{if(j.choice!=='fight'&&j.choice!=='flee'){reject(a,'fightOrFlee','not in options',j);return}
      (a.brainPlan||(a.brainPlan={})).fight={mob:id,choice:j.choice,t:clk}})}
  return false}

// ---- decision point: say ----
// Called from chat.js when the hero is about to speak. Returns a cached model line for this
// trigger (and spends it), or null so the table line is used; a miss queues a request so
// the next time this trigger comes up a line is ready.
export function brainLine(a,trigger,ctx){if(!a.brain||!SAY_TRIGGERS[trigger]||S.brainOn===false)return null;
  const c=lines.get(a.id),L=c&&c[trigger];
  if(L&&clk-L.t<=CFG.lineTtl){delete c[trigger];stats.applied.say++;return L.text}
  if(clk-(lastSay.get(a.id)||-1e9)<CFG.sayGap)return null;
  lastSay.set(a.id,clk);
  const flat={};for(const k in ctx||{})if(typeof ctx[k]!=='object')flat[k]=clip(ctx[k],30);
  ask(a,'say',{trigger,ctx:flat},j=>{const t=cleanLine(j.line);if(!t){reject(a,'say','bad line',j);return}
    let c2=lines.get(a.id);if(!c2)lines.set(a.id,c2={});c2[trigger]={text:t,t:clk}});
  return null}

// ---- once per step (sim/index.js): clock and plan prefetch for the few AI heroes ----
export function brainTick(dt){clk+=dt;const l=S.brainHeroes;if(!l||!l.length)return;
  acc+=dt;if(acc<1)return;acc=0;
  for(const id of l.slice()){const a=S.agents.find(x=>x.id===id);
    if(!a||a.state==='dead'){if(a)disableBrain(a);else S.brainHeroes=S.brainHeroes.filter(i=>i!==id);continue}
    if(a.state==='town'&&a.townStep<2){const p=a.brainPlan&&a.brainPlan.town;if(!p||p.used||p.t>clk||clk-p.t>CFG.planTtl)askTown(a)}}}
