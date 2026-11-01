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
// a.brain (flag), a.brainPlan ({town,fight}), a.mind (decision log) and S.brainHeroes (ids),
// all saved as-is. S.brainOn === false is the global kill switch (undefined means on).
//
// Decision log (issue #61): every request appends an entry to a.mind (newest first, cap
// MIND_MAX): {id,t,gameMin,kind,options,snapshot,choice,line,reason,ms,outcome,...}.
// snapshot is the exact object sent; sent:{id,system,user} is what the relay says the model
// saw (user is left out when it is exactly JSON.stringify(snapshot), userSame:true).
// outcome: pending -> applied | rejected (error) | late (the decision point passed first;
// scripted acted) | offline (no usable answer: unreachable, timeout or relay error; scripted
// acted) | superseded (replaced, expired unused, or orphaned by a reload). scripted holds the
// scripted choice actually taken when it differs from the model's.
import {ZONES,zoneFor,zoneAt,dist,CRYPT} from '../world/map.js';
import {FAC} from '../data/factions.js';
import {SLOTS} from '../data/items.js';
import {MOBS} from '../data/mobs.js';
import {raceOf} from '../data/races.js';
import {S,clockStr} from './state.js';
import {log} from './chronicle.js';
import {pop} from './effects.js';
import {maxHp,goHome,huntZone} from './heroes.js';
import {gearScore} from './gear.js';
import {nearHeroes,nearMobs} from './spatial.js';
import {friendsOf} from './bonds.js';
import {partyMates} from './party.js';
import {weatherName} from './weather.js';
import {cleanReason} from '../data/prompts.js';

export const CFG={url:'http://127.0.0.1:8787/decide',timeoutMs:3000,offlineSec:60,
  planTtl:900,fightTtl:20,lineTtl:1800,sayGap:25,maxPerHour:240,quietMin:60,sight:12};
// Triggers (data/barks.js) that may use a model line; idle and banter are left to the tables.
export const SAY_TRIGGERS={levelup:1,epic:1,kill:1,mourn:1,duel:1,spot:1,quest:1,party:1,depart:1,flee:1};

// ---- the scripted policy: today's behaviour, as an object so a policy is swappable ----
export const SCRIPTED={
  townPlan:a=>({zone:huntZone(a),crypt:true}),
  fightOrFlee:()=>'fight',
  say:()=>null};

// ---- transient (never saved) runtime state ----
let clk=0;                                   // sim seconds, advanced by brainTick
const busy=new Set(),offline=new Map(),lines=new Map(),asked=new Map(),sent=new Map(),lastSay=new Map(),inflight=new Map();
let lastQuiet=-1e9,fetchOverride=null,acc=0;
export const stats={sent:0,applied:{townPlan:0,fightOrFlee:0,say:0},rejected:0,dropped:0,timeouts:0,failures:0,fallback:0,lastZone:null};
export const rejections=[];
export const brainClock=()=>clk;
export function resetBrain(){clk=0;acc=0;busy.clear();offline.clear();lines.clear();asked.clear();sent.clear();lastSay.clear();inflight.clear();lastQuiet=-1e9;
  stats.sent=stats.rejected=stats.dropped=stats.timeouts=stats.failures=stats.fallback=0;
  stats.applied={townPlan:0,fightOrFlee:0,say:0};stats.lastZone=null;rejections.length=0}
export const setFetch=f=>{fetchOverride=f}; // tests only

// ---- who is AI-played ----
export function enableBrain(a){if(!a||a.kind!=='hero'||a.state==='dead')return false;
  a.brain=true;const l=S.brainHeroes||(S.brainHeroes=[]);if(!l.includes(a.id))l.push(a.id);return true}
export function disableBrain(a){if(!a)return;for(const e of a.mind||[])if(e.outcome==='pending')settle(e,'superseded',{error:'hero left AI play'});
  delete a.brain;delete a.brainPlan;lines.delete(a.id);offline.delete(a.id);
  if(S.brainHeroes)S.brainHeroes=S.brainHeroes.filter(i=>i!==a.id)}
export const brainStatus=a=>!a||!a.brain?'off':offline.get(a.id)>clk?'offline':'on';

// ---- snapshot: what the hero knows, compactly (target under ~600 tokens) ----
const pct=(h,m)=>Math.max(0,Math.round(h/m*100));
const dayPart=()=>{const h=(S.gameMin/60)%24;return h<5||h>=21?'night':h<8?'dawn':h<18?'day':'dusk'};
const clip=(s,n)=>String(s==null?'':s).slice(0,n);
export function legalZones(a){const z=huntZone(a),out=[];if(z>0)out.push(z-1);out.push(z);return out}
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

// ---- decision log (issue #61) ----
export const MIND_MAX=30;
const stamp=()=>'D'+(Math.floor(S.gameMin/1440)+1)+' '+clockStr();
function mindAdd(a,kind,snap){const m=a.mind||(a.mind=[]);a.mindSeq=(a.mindSeq||0)+1;
  const e={id:a.mindSeq,t:stamp(),gameMin:Math.floor(S.gameMin),kind,options:snap.options?snap.options.slice():null,snapshot:snap,
    choice:null,line:null,reason:null,ms:null,outcome:'pending'};
  if(kind==='say')e.trigger=snap.trigger;
  m.unshift(e);if(m.length>MIND_MAX)m.length=MIND_MAX;return e}
const mindGet=(a,id)=>id&&a.mind?a.mind.find(e=>e.id===id)||null:null;
// Final outcome for an entry; the first final outcome wins (later events only add detail).
function settle(e,outcome,more){if(!e)return;if(more)for(const k in more)if(more[k]!=null&&e[k]==null)e[k]=more[k];
  if(e.outcome==='pending')e.outcome=outcome}
// What the scripted policy does at this decision point, as the entry shows it.
const scriptedFor=(a,kind)=>kind==='townPlan'?ZONES[SCRIPTED.townPlan(a).zone]:kind==='fightOrFlee'?'fight':null;
// Whether a pending entry still has a live answer parked for its decision point.
function parked(a,e){const P=a.brainPlan||{};
  if(e.kind==='townPlan'){const p=P.town;return !!(p&&p.mid===e.id&&!p.used&&p.t<=clk&&clk-p.t<=CFG.planTtl)}
  if(e.kind==='fightOrFlee'){const f=P.fight;return !!(f&&f.mid===e.id&&!f.done&&f.t<=clk&&clk-f.t<=CFG.fightTtl)}
  const c=lines.get(a.id),L=c&&c[e.trigger];return !!(L&&L.mid===e.id&&clk-L.t<=CFG.lineTtl)}
const fightOn=(a,mob)=>a.state==='fight'&&a.target&&a.target.id===mob;
// Once a second per AI hero: close entries whose decision point passed or whose answer is gone.
function mindSweep(a){if(!a.mind)return;
  for(const e of a.mind){if(e.outcome!=='pending')continue;
    const fl=inflight.get(a.id+':'+e.id);
    if(e.kind==='fightOrFlee'){const mob=fl?fl.mob:a.brainPlan&&a.brainPlan.fight&&a.brainPlan.fight.mid===e.id?a.brainPlan.fight.mob:null;
      if(mob!=null&&!fightOn(a,mob)){settle(e,'late',{scripted:'fight',error:'the fight ended first'});continue}}
    if(fl||parked(a,e))continue;
    settle(e,'superseded',{error:'answer expired unused'})}}

// ---- relay client ----
const dim=t=>({t,c:'dm'});
function quiet(a){ // one dim line per game hour at most
  if(S.gameMin-lastQuiet<CFG.quietMin)return;lastQuiet=S.gameMin;log(a,dim('’s thoughts go quiet.'))}
function failed(a,timeout){stats.failures++;if(timeout)stats.timeouts++;offline.set(a.id,clk+CFG.offlineSec);quiet(a)}
const budgetOk=id=>{const now=Date.now(),l=(sent.get(id)||[]).filter(t=>now-t<3.6e6);sent.set(id,l);return l.length<CFG.maxPerHour};
const canAsk=a=>(fetchOverride||typeof fetch==='function')&&S.brainOn!==false&&a&&a.brain&&a.state!=='dead'&&!(offline.get(a.id)>clk)&&budgetOk(a.id);
function reject(a,kind,why,raw,e){stats.rejected++;if(rejections.length>=50)rejections.shift();
  rejections.push({kind,hero:a.name,why,raw:clip(JSON.stringify(raw),120)});
  if(e)settle(e,'rejected',{error:why,scripted:scriptedFor(a,kind)})}

// Fire-and-forget. onOk(res, entry) runs when a well-formed JSON object came back in time; it
// only parks data (a.brainPlan or the line cache) and never touches the running simulation.
// Each request is one entry in a.mind, updated in place as the answer and the decision point
// arrive; ctx holds transient facts the sweep needs (the mob of a fight).
function ask(a,kind,extra,onOk,ctx){
  const key=a.id+':'+kind;if(busy.has(key)||!canAsk(a))return false;
  let body,snap;try{snap=snapshotFor(a,kind,extra);body=JSON.stringify({kind,snapshot:snap})}catch(e){return false}
  const me=mindAdd(a,kind,snap),fk=a.id+':'+me.id;inflight.set(fk,ctx||{});
  busy.add(key);stats.sent++;
  let l=sent.get(a.id);if(!l)sent.set(a.id,l=[]);l.push(Date.now());
  const t0=clk,w0=Date.now(),ac=typeof AbortController==='function'?new AbortController():null;
  let over=false,timer=null;
  const finish=()=>{over=true;clearTimeout(timer);busy.delete(key);inflight.delete(fk);me.ms=Date.now()-w0};
  const down=(why,j)=>{if(j&&j.sent)keepSent(me,j.sent);settle(me,'offline',{error:why,scripted:scriptedFor(a,kind)})};
  timer=setTimeout(()=>{if(over)return;finish();failed(a,true);down('timeout after '+CFG.timeoutMs+' ms');if(ac)ac.abort()},CFG.timeoutMs);
  try{(fetchOverride||fetch)(CFG.url,{method:'POST',headers:{'content-type':'application/json'},body,signal:ac&&ac.signal})
    .then(r=>r.json().then(j=>({ok:r.ok,j})))
    .then(({ok,j})=>{if(over)return;finish();
      if(!ok||!j||typeof j!=='object'||j.error){failed(a,false);down(j&&j.error?'relay: '+clip(j.error,120):'relay error',j);return}
      if(j.sent)keepSent(me,j.sent);if(j.usage&&typeof j.usage==='object')me.usage={in:+j.usage.in||0,out:+j.usage.out||0};
      if(clk-t0>CFG.planTtl||a.state==='dead'||!a.brain){stats.dropped++;settle(me,'late',{scripted:scriptedFor(a,kind),error:'answer came too late'});return}
      try{onOk(j,me)}catch(e){stats.dropped++;settle(me,'rejected',{error:'could not apply: '+clip(e.message,80)})}})
    .catch(()=>{if(over)return;finish();failed(a,false);down('relay unreachable')})}
  catch(e){finish();failed(a,false);down('relay unreachable');return false}
  return true}
// Keep the relay's echo of the prompt; the user content is dropped when it is exactly the snapshot.
function keepSent(e,x){if(!x||typeof x!=='object')return;const user=typeof x.user==='string'?x.user:null;
  const same=user!=null&&user===JSON.stringify(e.snapshot);
  e.sent={id:clip(x.id,40),system:clip(x.system,8000),...(same?{userSame:true}:{user:user==null?null:clip(user,8000)})}}
// The exact user content the model saw (the relay echo, or the snapshot it was built from).
export const mindUser=e=>e.sent&&typeof e.sent.user==='string'?e.sent.user:JSON.stringify(e.snapshot)

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
  if(p&&!p.used&&p.t<=clk&&clk-p.t<=CFG.planTtl){p.used=1;const ix=legalZones(a).find(i=>ZONES[i]===p.choice),e=mindGet(a,p.mid);
    if(ix!==undefined){stats.applied.townPlan++;stats.lastZone={id:a.id,zone:ix};settle(e,'applied',ix!==dflt?{scripted:ZONES[dflt]}:null);return ix}
    reject(a,'townPlan','illegal at apply',p.choice,e)}
  // a question still in flight missed the gate: the scripted zone is taken
  for(const e of a.mind||[])if(e.kind==='townPlan'&&e.outcome==='pending'&&inflight.has(a.id+':'+e.id))settle(e,'late',{scripted:ZONES[dflt],error:'left town before the answer came'});
  stats.fallback++;return dflt}
// Whether a hero would answer a Sunken Crypt call; scripted heroes always do.
export function brainOk(a,what){if(!a.brain||S.brainOn===false||what!=='crypt')return true;
  const p=a.brainPlan&&a.brainPlan.town;return !(p&&p.t<=clk&&clk-p.t<=CFG.planTtl&&p.crypt===false)}
function askTown(a){if(legalZones(a).length<2&&a.lvl<7)return;
  const old=a.brainPlan&&a.brainPlan.town;
  if(ask(a,'townPlan',{},(j,e)=>{const names=legalZones(a).map(i=>ZONES[i]);
    if(typeof j.choice==='string')e.choice=clip(j.choice,40);e.reason=cleanReason(j.reason);if(typeof j.crypt==='boolean')e.crypt=j.crypt;
    if(typeof j.choice!=='string'||!names.includes(j.choice)||typeof j.crypt!=='boolean'){reject(a,'townPlan','not in options',j,e);return}
    if(e.outcome!=='pending')return; // the hero already left; recorded, not parked
    (a.brainPlan||(a.brainPlan={})).town={choice:j.choice,crypt:j.crypt,t:clk,mid:e.id}})&&old&&!old.used)
    settle(mindGet(a,old.mid),'superseded',{error:'replaced by a newer plan'})}

// ---- decision point: fightOrFlee ----
// Called every fight tick (heroes.js fight case). Asks once when HP first drops under 50%
// against a mob 1+ levels above; an arriving 'flee' is applied on a later tick if the same
// fight is still on. Scripted heroes return at the first test.
export function brainFight(a,m,mh){if(!a.brain||S.brainOn===false||!m)return false;
  const f=a.brainPlan&&a.brainPlan.fight;
  if(f&&f.mob===m.id&&!f.done&&f.t<=clk&&clk-f.t<=CFG.fightTtl){f.done=1;const e=mindGet(a,f.mid);
    if(f.choice==='flee'&&a.state==='fight'){stats.applied.fightOrFlee++;settle(e,'applied',{scripted:'fight'});m.target=null;goHome(a);pop(a.x,a.y-.8,'FLEE','#ffb060');return true}
    settle(e,'applied');return false}
  if(a.hp<mh*.5&&m.lvl>=a.lvl+1&&asked.get(a.id)!==m.id){asked.set(a.id,m.id);const id=m.id;
    ask(a,'fightOrFlee',{mob:m},(j,e)=>{if(typeof j.choice==='string')e.choice=clip(j.choice,20);e.reason=cleanReason(j.reason);
      const ln=cleanLine(j.line);if(ln)e.line=ln;
      if(j.choice!=='fight'&&j.choice!=='flee'){reject(a,'fightOrFlee','not in options',j,e);return}
      if(e.outcome!=='pending'||!fightOn(a,id)){settle(e,'late',{scripted:'fight',error:'the fight ended first'});return}
      (a.brainPlan||(a.brainPlan={})).fight={mob:id,choice:j.choice,t:clk,mid:e.id}},{mob:id})}
  return false}

// ---- decision point: say ----
// Called from chat.js when the hero is about to speak. Returns a cached model line for this
// trigger (and spends it), or null so the table line is used; a miss queues a request so
// the next time this trigger comes up a line is ready.
export function brainLine(a,trigger,ctx){if(!a.brain||!SAY_TRIGGERS[trigger]||S.brainOn===false)return null;
  const c=lines.get(a.id),L=c&&c[trigger];
  if(L&&clk-L.t<=CFG.lineTtl){delete c[trigger];stats.applied.say++;settle(mindGet(a,L.mid),'applied');return L.text}
  if(clk-(lastSay.get(a.id)||-1e9)<CFG.sayGap)return null;
  lastSay.set(a.id,clk);
  const flat={};for(const k in ctx||{})if(typeof ctx[k]!=='object')flat[k]=clip(ctx[k],30);
  ask(a,'say',{trigger,ctx:flat},(j,e)=>{const t=cleanLine(j.line);if(typeof j.line==='string')e.line=clip(j.line,120);
    if(!t){reject(a,'say','bad line',j,e);return}
    let c2=lines.get(a.id);if(!c2)lines.set(a.id,c2={});const prev=c2[trigger];
    if(prev&&prev.mid)settle(mindGet(a,prev.mid),'superseded',{error:'replaced by a newer line'});
    c2[trigger]={text:t,t:clk,mid:e.id}});
  return null}

// ---- once per step (sim/index.js): clock and plan prefetch for the few AI heroes ----
export function brainTick(dt){clk+=dt;const l=S.brainHeroes;if(!l||!l.length)return;
  acc+=dt;if(acc<1)return;acc=0;
  for(const id of l.slice()){const a=S.agents.find(x=>x.id===id);
    if(!a||a.state==='dead'){if(a)disableBrain(a);else S.brainHeroes=S.brainHeroes.filter(i=>i!==id);continue}
    if(a.state==='town'&&a.townStep<2){const p=a.brainPlan&&a.brainPlan.town;if(!p||p.used||p.t>clk||clk-p.t>CFG.planTtl)askTown(a)}
    mindSweep(a)}}
