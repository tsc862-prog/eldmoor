// The brain layer (issue #40): decision points where a hero's choice can come from a
// policy other than the scripted state machine. Owned by brain-builder.
//
// Decision points (all async-capable, none per tick):
//   townPlan(a)            zone for the next trip, and whether to answer a Sunken Crypt call
//                          (a party leader picks for the party; a follower is asked only
//                          the crypt call, kind 'cryptCall'; see partyZone below)
//   fightOrFlee(a,m)       once HP crosses 50% in a fight with a mob 1+ levels above
//   say(a,trigger,ctx)     one in-voice line in the moment, or none (chat.js)
// The scripted policy is today's logic. A hero with a.brain asks the relay
// (scripts/relay.mjs, 127.0.0.1:8787) fire-and-forget; the answer is validated against
// the options the sim offered and parked in a.brainPlan, and is applied at the NEXT
// decision point. A say answer (issue #71) is spoken on the next step if it came within
// CFG.sayFresh sim seconds and the hero is still in the same situation, else dropped. The sim never awaits a model: late, malformed or
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
// outcome: pending -> applied | rejected (error) | late (the decision point or the moment
// passed first; scripted acted) | offline (no usable answer: unreachable, timeout or relay error; scripted
// acted) | superseded (replaced, expired unused, or orphaned by a reload) | overruled (a legal
// answer the party would not follow: a leader's zone outside the weakest member's range, or a
// follower's zone when the party goes elsewhere). scripted holds the
// scripted choice actually taken when it differs from the model's.
//
// Parties (issue: plans respect parties): the leader decides. partyZone(a) is called by every
// party member at the town gate; the first call of a trip lets an AI leader's fresh plan set
// p.zone, limited to partyLegal(p) (the legal range of the weakest member, from the leader's
// home). Followers are never asked for a zone: an AI follower asks only the crypt question
// (kind 'cryptCall') and logs a token-free 'follow' entry when it leaves with the party.
import {ZONES,zoneFor,zoneAt,dist,CRYPT} from '../world/map.js';
import {FAC} from '../data/factions.js';
import {SLOTS} from '../data/items.js';
import {MOBS} from '../data/mobs.js';
import {raceOf,homeOf} from '../data/races.js';
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
import {speak} from './chat.js';
import {topScores} from './abilities.js';
import {combatStats} from './stats.js';
import {fellowCard} from './persona.js';
import * as TH from './throttle.js';
import {setChapterWriter,applyChapter} from './tiers.js';

export const CFG={url:'http://127.0.0.1:8787/decide',timeoutMs:3000,localTimeoutMs:9000,localWriteMs:35000,offlineSec:60,
  planTtl:900,fightTtl:20,sayFresh:4,aiQuietTable:true,sayGap:25,maxPerHour:240,quietMin:60,sight:12};
// sayFresh: sim seconds after the trigger in which a model line may still be said.
// aiQuietTable: an AI hero holds its table line back while a model line is asked for, and
// says it only if no model line is said within sayFresh. Scripted heroes never hold.
// Triggers (data/barks.js) that may use a model line; idle and banter are left to the tables.
export const SAY_TRIGGERS={levelup:1,epic:1,kill:1,mourn:1,duel:1,spot:1,quest:1,party:1,depart:1,flee:1};

// ---- the scripted policy: today's behaviour, as an object so a policy is swappable ----
export const SCRIPTED={
  townPlan:a=>({zone:huntZone(a),crypt:true}),
  fightOrFlee:()=>'fight',
  say:()=>null};

// ---- transient (never saved) runtime state ----
let clk=0;                                   // sim seconds, advanced by brainTick
const busy=new Set(),offline=new Map(),asked=new Map(),sent=new Map(),lastSay=new Map(),inflight=new Map();
const ready=new Map(),held=new Map();        // per hero: model line waiting for the next step / table line held back
let lastQuiet=-1e9,fetchOverride=null,acc=0;
export const stats={sent:0,applied:{townPlan:0,fightOrFlee:0,say:0},rejected:0,dropped:0,timeouts:0,failures:0,fallback:0,lastZone:null};
export const rejections=[];
export const brainClock=()=>clk;
export function resetBrain(){TH.resetThrottle();clk=0;acc=0;busy.clear();offline.clear();ready.clear();held.clear();asked.clear();sent.clear();lastSay.clear();inflight.clear();lastQuiet=-1e9;
  stats.sent=stats.rejected=stats.dropped=stats.timeouts=stats.failures=stats.fallback=0;
  stats.applied={townPlan:0,fightOrFlee:0,say:0};stats.lastZone=null;rejections.length=0}
export const setFetch=f=>{fetchOverride=f}; // tests only

// ---- which mind (Mixed minds, issue #97) ----
// a.brainCfg = {provider, model?, effort?}: the same shape as the agent runner's per-hero settings (#93,
// sess.runner), so a later provider-neutral runner can read it. No brainCfg = the relay's default
// (Claude). Saved with the hero. Local providers get longer timeouts and cost nothing.
export const MIND_PROVIDERS=['anthropic','ollama','openai','google'];
export const LOCAL_PROVIDERS={ollama:1};
export const PROVIDER_LABEL={anthropic:'Claude',ollama:'Local (Ollama)',openai:'OpenAI',google:'Google'};
const MODEL_OK=/^[A-Za-z0-9][\w.:\/+-]{0,99}$/;
export function mindCfg(a){const c=a&&a.brainCfg;if(!c||typeof c!=='object'||!MIND_PROVIDERS.includes(c.provider))return null;
  const o={provider:c.provider};if(typeof c.model==='string'&&MODEL_OK.test(c.model))o.model=c.model;if(c.effort==='low'||c.effort==='medium'||c.effort==='high')o.effort=c.effort;return o}
// Set (or clear, with null or provider 'anthropic' and no model) the hero's mind; returns the stored value.
export function setMind(a,cfg){if(!a)return null;const c=cfg&&MIND_PROVIDERS.includes(cfg.provider)?mindCfg({brainCfg:cfg}):null;
  if(!c||(c.provider==='anthropic'&&!c.model&&!c.effort))delete a.brainCfg;else a.brainCfg=c;return a.brainCfg||null}
// Writing mind (#478): an agent-played hero's relay writing requests (chapter, persona, backstory, memory) follow the
// runner that holds it (the host reports {provider, model} from the relay's claims) unless an explicit a.brainCfg is set.
let runnerMindFn=null;
export function setRunnerMind(fn){runnerMindFn=typeof fn==='function'?fn:null}
export function writeCfg(a){const c=mindCfg(a);if(c||!a||!a.player||!runnerMindFn)return c;
  const r=runnerMindFn(a);if(!r||typeof r!=='object'||!MIND_PROVIDERS.includes(r.provider))return null;
  const o={provider:r.provider};if(typeof r.model==='string'&&MODEL_OK.test(r.model))o.model=r.model;return o}
const isLocalMind=a=>{const c=mindCfg(a);return !!(c&&LOCAL_PROVIDERS[c.provider])};
// Short label for a model: "qwen2.5:14b · local", "claude-haiku-5-5". From an entry (what answered) or a setting.
export function modelTag(x){if(!x)return null;const m=x.model,p=x.provider;
  if(!m)return p&&p!=='anthropic'?(PROVIDER_LABEL[p]||p):null;return m+(LOCAL_PROVIDERS[p]?' · local':p==='openai'?' · openai':'')}
// The hero's current mind as a tag: its setting, or 'Claude' for the relay default.
export const mindTag=a=>{const c=mindCfg(a);return c?modelTag(c)||PROVIDER_LABEL[c.provider]:'Claude'};

// ---- who is AI-played ----
export function enableBrain(a){if(!a||a.kind!=='hero'||a.state==='dead')return false;
  a.brain=true;const l=S.brainHeroes||(S.brainHeroes=[]);if(!l.includes(a.id))l.push(a.id);return true}
export function disableBrain(a){if(!a)return;for(const e of a.mind||[])if(e.outcome==='pending')settle(e,'superseded',{error:'hero left AI play'});
  delete a.brain;delete a.brainPlan;ready.delete(a.id);held.delete(a.id);offline.delete(a.id);
  if(S.brainHeroes)S.brainHeroes=S.brainHeroes.filter(i=>i!==a.id)}
export const brainStatus=a=>!a||!a.brain?'off':offline.get(a.id)>clk?'offline':'on';

// ---- snapshot: what the hero knows, compactly (target under ~600 tokens) ----
const pct=(h,m)=>Math.max(0,Math.round(h/m*100));
const dayPart=()=>{const h=(S.gameMin/60)%24;return h<5||h>=21?'night':h<8?'dawn':h<18?'day':'dusk'};
const clip=(s,n)=>String(s==null?'':s).slice(0,n);
const around=z=>{const out=[];if(z>0)out.push(z-1);out.push(z);return out};
export const legalZones=a=>around(huntZone(a));
// The weakest member of a party, and the zones legal for the whole party (its level, the leader's home).
const weakest=p=>p.mem.reduce((w,b)=>b.lvl<w.lvl?b:w,p.mem[0]);
export const partyLegal=p=>around(zoneFor(weakest(p).lvl,homeOf(p.leader).gate));
// Who may still be asked where to go: a solo hero, or a party leader before the party's zone is set.
const zoneQ=a=>!a.party||(a.party.leader===a&&!a.party.set);
const townOptions=a=>a.party&&a.party.leader===a?partyLegal(a.party):legalZones(a);
// "health 212, attack 48, defense 31%, crit 9%, 0.95 blows/s"
const combatLine=a=>{const c=combatStats(a);return 'health '+c.health+', attack '+Math.round(c.attack)+', defense '+Math.round(c.defense*100)+'%, crit '+Math.round(c.crit*100)+'%, '+c.aps.toFixed(2)+' blows/s'};
export function snapshotFor(a,kind,extra={}){
  const mh=maxHp(a),z=zoneAt(a.x,a.y),R=CFG.sight;
  let top=null;for(const k of SLOTS){const it=a.slots&&a.slots[k];if(it&&(!top||it.ilvl>top.ilvl))top=it}
  const q=a.quest;
  const s={fac:FAC[a.fac].name,name:a.name,race:raceOf(a).name,cls:a.cls,lvl:a.lvl,hp:pct(a.hp,mh),gold:a.gold,
    gear:Math.round(gearScore(a)*10)/10,best:top?clip(top.name,40)+' ilvl '+top.ilvl:'none',
    combat:combatLine(a), // the five combat totals (sim/stats.js), one short string
    traits:(a.traits||[]).join(', '),origin:clip(a.origin,160),
    scores:topScores(a),skills:(a.prof||[]).join(', '), // ability scores (sim/abilities.js)
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
  if(a.fellow){const fc=fellowCard(a);if(fc)s.fellow=fc} // Fellowship (#68): persona, backstory summary, memory and companion stances
  s.kind=kind;
  if(kind==='townPlan'){s.options=townOptions(a).map(i=>ZONES[i]);s.cryptOpen=a.lvl>=7;if(a.party&&a.party.leader===a)s.leadParty=true}
  else if(kind==='cryptCall'){s.cryptOpen=true;if(a.party)s.leader=a.party.leader.name}
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
// A settled entry for something the hero did without asking the model (no snapshot, no tokens).
function mindNote(a,kind,f){const m=a.mind||(a.mind=[]);a.mindSeq=(a.mindSeq||0)+1;
  const e={id:a.mindSeq,t:stamp(),gameMin:Math.floor(S.gameMin),kind,options:null,snapshot:null,choice:null,line:null,reason:null,ms:null,outcome:'applied',...f};
  m.unshift(e);if(m.length>MIND_MAX)m.length=MIND_MAX;return e}
const mindGet=(a,id)=>id&&a.mind?a.mind.find(e=>e.id===id)||null:null;
// Final outcome for an entry; the first final outcome wins (later events only add detail).
function settle(e,outcome,more){if(!e)return;if(more)for(const k in more)if(more[k]!=null&&e[k]==null)e[k]=more[k];
  if(e.outcome==='pending')e.outcome=outcome}
// What the scripted policy does at this decision point, as the entry shows it.
const scriptedFor=(a,kind)=>kind==='townPlan'?ZONES[SCRIPTED.townPlan(a).zone]:kind==='fightOrFlee'?'fight':null;
// Whether a pending entry still has a live answer parked for its decision point.
function parked(a,e){const P=a.brainPlan||{};
  if(e.kind==='townPlan'||e.kind==='cryptCall'){const p=P.town;return !!(p&&p.mid===e.id&&!p.used&&p.t<=clk&&clk-p.t<=CFG.planTtl)}
  if(e.kind==='fightOrFlee'){const f=P.fight;return !!(f&&f.mid===e.id&&!f.done&&f.t<=clk&&clk-f.t<=CFG.fightTtl)}
  const r=ready.get(a.id);return !!(r&&r.mid===e.id)}
const fightOn=(a,mob)=>a.state==='fight'&&a.target&&a.target.id===mob;
// Once a second per AI hero: close entries whose decision point passed or whose answer is gone.
function mindSweep(a){if(!a.mind)return;
  for(const e of a.mind){if(e.outcome!=='pending')continue;
    const fl=inflight.get(a.id+':'+e.id);
    if(e.kind==='fightOrFlee'){const mob=fl?fl.mob:a.brainPlan&&a.brainPlan.fight&&a.brainPlan.fight.mid===e.id?a.brainPlan.fight.mob:null;
      if(mob!=null&&!fightOn(a,mob)){settle(e,'late',{scripted:'fight',error:'the fight ended first'});continue}}
    if(fl||parked(a,e))continue;
    settle(e,'superseded',{error:e.kind==='townPlan'||e.kind==='cryptCall'?(a.state==='town'?'the hero did not leave town in time':'the hero left town without passing the gate'):'answer expired unused'})}}

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
// only parks data (a.brainPlan or the ready line) and never touches the running simulation.
// Each request is one entry in a.mind, updated in place as the answer and the decision point
// arrive; ctx holds transient facts the sweep needs (the mob of a fight).
function ask(a,kind,extra,onOk,ctx){
  const key=a.id+':'+kind;if(busy.has(key)||!canAsk(a))return false;
  const mc=mindCfg(a),tmo=isLocalMind(a)?CFG.localTimeoutMs:CFG.timeoutMs;
  let body,snap;try{snap=snapshotFor(a,kind,extra);body=JSON.stringify({kind,snapshot:snap,...(mc||{})})}catch(e){return false}
  const me=mindAdd(a,kind,snap),fk=a.id+':'+me.id;inflight.set(fk,ctx||{});
  if(mc){me.provider=mc.provider;if(mc.model)me.model=mc.model} // what was asked; the reply names what answered
  busy.add(key);stats.sent++;TH.sent(kind);
  let l=sent.get(a.id);if(!l)sent.set(a.id,l=[]);l.push(Date.now());
  const t0=clk,w0=Date.now(),ac=typeof AbortController==='function'?new AbortController():null;
  let over=false,timer=null;
  const finish=()=>{over=true;clearTimeout(timer);busy.delete(key);inflight.delete(fk);me.ms=Date.now()-w0};
  const who=j=>{if(j&&typeof j.provider==='string')me.provider=clip(j.provider,20);if(j&&typeof j.model==='string')me.model=clip(j.model,100)};
  const down=(why,j)=>{TH.fail(kind,a,why);if(j&&j.sent)keepSent(me,j.sent);who(j);settle(me,'offline',{error:why,scripted:scriptedFor(a,kind)})};
  timer=setTimeout(()=>{if(over)return;finish();failed(a,true);down('timeout after '+tmo+' ms');if(ac)ac.abort()},tmo);
  try{(fetchOverride||fetch)(CFG.url,{method:'POST',headers:{'content-type':'application/json'},body,signal:ac&&ac.signal})
    .then(r=>r.json().then(j=>({ok:r.ok,j})))
    .then(({ok,j})=>{if(over)return;finish();
      if(!ok||!j||typeof j!=='object'||j.error){failed(a,false);down(j&&j.error?'relay: '+clip(j.error,120):'relay error',j);return}
      TH.ok(kind,a);if(j.sent)keepSent(me,j.sent);who(j);if(j.usage&&typeof j.usage==='object')me.usage={in:+j.usage.in||0,out:+j.usage.out||0,cost:+j.usage.cost||0};
      if(clk-t0>CFG.planTtl||a.state==='dead'||!a.brain){stats.dropped++;settle(me,'late',{scripted:scriptedFor(a,kind),error:'answer came too late'});return}
      try{onOk(j,me)}catch(e){stats.dropped++;settle(me,'rejected',{error:'could not apply: '+clip(e.message,80)})}})
    .catch(()=>{if(over)return;finish();failed(a,false);down('relay unreachable')})}
  catch(e){finish();failed(a,false);down('relay unreachable');return false}
  return true}
// One-off writing request (Fellowship persona, backstory, memory summary; #68). Not a decision:
// no Mind entry, no hero gating. Resolves to the relay's reply object, or null on any failure
// (relay down, timeout, {error}, kill switch). The caller validates and applies; nothing waits.
// hero (optional): whose mind writes it (a.brainCfg: provider and model); a local mind gets at least CFG.localWriteMs.
export function askRelay(kind,snapshot,timeoutMs=CFG.timeoutMs,hero=null){
  const mc=writeCfg(hero);if(mc&&LOCAL_PROVIDERS[mc.provider])timeoutMs=Math.max(timeoutMs,CFG.localWriteMs);
  if(S.brainOn===false||!(fetchOverride||typeof fetch==='function'))return Promise.resolve(null);
  if(TH.blocked(kind,hero)){TH.denied(kind);return Promise.resolve(null)} // backing off after a failed answer (#117)
  const ac=typeof AbortController==='function'?new AbortController():null,w0=Date.now();
  let timer=null,over=false;const late=new Promise(res=>{timer=setTimeout(()=>{if(over)return;over=true;TH.fail(kind,hero,'timeout');if(ac)ac.abort();res(null)},timeoutMs)});
  let body;try{body=JSON.stringify({kind,snapshot,...(mc||{})})}catch(e){clearTimeout(timer);return Promise.resolve(null)}
  TH.sent(kind);
  const go=Promise.resolve().then(()=>(fetchOverride||fetch)(CFG.url,{method:'POST',headers:{'content-type':'application/json'},body,signal:ac&&ac.signal}))
    .then(r=>r.json().then(j=>({j,st:r.status}))).then(({j,st})=>{if(over)return null;over=true;
      if(j&&typeof j==='object'&&!j.error&&st<400){TH.ok(kind,hero);return {...j,ms:Date.now()-w0}}
      TH.fail(kind,hero,(st===429?'429 ':'')+(j&&j.error?String(j.error):'relay error '+st));return null}).catch(()=>{if(!over){over=true;TH.fail(kind,hero,'unreachable')}return null});
  return Promise.race([go,late]).finally(()=>clearTimeout(timer))}
// Journal chapters (#153, sim/tiers.js): the scripted digest is in place at once; the relay may rewrite it (kind
// 'chapter') for an agent-played hero or a Fellowship member whose Fellowship has relay writing on. Never awaited.
setChapterWriter((a,snap,stamp)=>{const F=S.fellowship;if(!(a.player||a.fellow&&F&&F.ai)||a.state==='dead')return;
  askRelay('chapter',snap,16000,a).then(j=>{if(j)applyChapter(a,stamp,j)}).catch(()=>{})});
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
    if(p.choice==null){settle(e,'applied');lateTown(a,ZONES[dflt]);stats.fallback++;return dflt} // a crypt-only plan (asked as a follower) carries no zone
    if(ix!==undefined){stats.applied.townPlan++;stats.lastZone={id:a.id,zone:ix};settle(e,'applied',ix!==dflt?{scripted:ZONES[dflt]}:null);return ix}
    reject(a,'townPlan','illegal at apply',p.choice,e)}
  lateTown(a,ZONES[dflt]);stats.fallback++;return dflt}
// A town question still in flight missed the gate: the zone actually taken is noted.
function lateTown(a,zone,why){for(const e of a.mind||[])if((e.kind==='townPlan'||e.kind==='cryptCall')&&e.outcome==='pending'&&inflight.has(a.id+':'+e.id))
  settle(e,'late',{scripted:e.kind==='townPlan'?zone:null,error:why||'left town before the answer came'})}

// ---- parties: the leader decides, followers follow ----
// Called by every party member at the town gate (heroes.js step 2) in place of reading p.zone.
// The first call of a trip settles the zone once (p.set): an AI leader's fresh plan sets it if
// it is legal for the weakest member, else it is overruled and p.zone (the scripted zone set
// when the party formed, from the weakest member) stands. With no AI leader nothing changes:
// the return value is exactly p.zone. An AI follower logs that it follows.
export function partyZone(a){const p=a.party;if(!p)return townZone(a);
  if(!p.set&&p.leader.brain&&S.brainOn!==false){p.set=1;leaderDecides(p)}
  if(a.brain&&S.brainOn!==false&&a!==p.leader)follows(a,p);
  return p.zone}
function leaderDecides(p){const L=p.leader,dflt=p.zone,P=L.brainPlan&&L.brainPlan.town;
  if(P&&!P.used&&P.t<=clk&&clk-P.t<=CFG.planTtl){P.used=1;const e=mindGet(L,P.mid);
    if(P.choice==null){settle(e,'applied');lateTown(L,ZONES[dflt],'the party left before the answer came');stats.fallback++;return}
    const ix=partyLegal(p).find(i=>ZONES[i]===P.choice);
    if(ix!==undefined){p.zone=ix;stats.applied.townPlan++;stats.lastZone={id:L.id,zone:ix,party:p.id};settle(e,'applied',ix!==dflt?{scripted:ZONES[dflt]}:null);return}
    const w=weakest(p),why='too far for '+w.name+' (L'+w.lvl+'); the party goes to '+ZONES[dflt];
    stats.rejected++;if(rejections.length>=50)rejections.shift();rejections.push({kind:'townPlan',hero:L.name,why:'overruled: '+why,raw:clip(P.choice,40)});
    settle(e,'overruled',{error:why,scripted:ZONES[dflt]});return}
  lateTown(L,ZONES[dflt],'the party left before the answer came');stats.fallback++}
// The active adventure a hero drives or joined (sim/dm.js keeps them on S.adventures), or null.
const jobOf=a=>a&&a.adv!=null&&S.adventures?S.adventures.find(v=>v.id===a.adv&&v.phase==='active')||null:null;
// Called at the gate right after the DM sent this hero (solo, or a party leader) on an adventure
// (heroes.js: dmDepart runs before the zone pick, so a posted job outranks any zone plan).
// The hero's zone plan, parked or still in flight, settles 'overruled' instead of expiring;
// a crypt-only answer stays applied. Scripted heroes return at the first test.
export function brainJob(a){if(!a.brain||S.brainOn===false)return;
  const adv=jobOf(a),why=(a.party?'the party took a job: ':'took a job: ')+(adv?adv.title:'an adventure');
  if(a.party&&a.party.leader===a)a.party.set=1; // the zone question is closed for this trip
  const P=a.brainPlan&&a.brainPlan.town;
  if(P&&!P.used&&P.t<=clk&&clk-P.t<=CFG.planTtl){P.used=1;const e=mindGet(a,P.mid);
    if(P.choice==null)settle(e,'applied');else settle(e,'overruled',{error:why})}
  for(const e of a.mind||[])if(e.outcome==='pending'&&inflight.has(a.id+':'+e.id)){
    if(e.kind==='townPlan')settle(e,'overruled',{error:why});else if(e.kind==='cryptCall')settle(e,'late',{error:'left town before the answer came'})}}
function follows(a,p){const z=ZONES[p.zone],P=a.brainPlan&&a.brainPlan.town,job=jobOf(p.leader);
  if(P&&!P.used&&P.t<=clk&&clk-P.t<=CFG.planTtl){P.used=1;const e=mindGet(a,P.mid); // the crypt answer stays in force (brainOk)
    if(P.choice==null||(P.choice===z&&!job))settle(e,'applied');
    else settle(e,'overruled',{error:job?'the party took a job: '+job.title:'the party goes to '+z+'; '+p.leader.name+' leads',scripted:job?null:z})}
  lateTown(a,z,'left town with the party before the answer came');
  mindNote(a,'follow',{choice:z,reason:job?'follows the party on '+job.title:'follows the party to '+z,leader:p.leader.name})}
// Whether a hero would answer a Sunken Crypt call; scripted heroes always do.
export function brainOk(a,what){if(!a.brain||S.brainOn===false||what!=='crypt')return true;
  const p=a.brainPlan&&a.brainPlan.town;return !(p&&p.t<=clk&&clk-p.t<=CFG.planTtl&&p.crypt===false)}
// A solo hero (or a party leader before the zone is set) is asked the zone and the crypt call;
// a party follower only the crypt call, and nothing at all when the crypt is not open to it.
function askTown(a){const old=a.brainPlan&&a.brainPlan.town,park=(e,f)=>{(a.brainPlan||(a.brainPlan={})).town={...f,t:clk,mid:e.id}};
  let sent_;
  if(zoneQ(a)){if(townOptions(a).length<2&&a.lvl<7)return;
    sent_=ask(a,'townPlan',{},(j,e)=>{const names=e.options||[];
      if(typeof j.choice==='string')e.choice=clip(j.choice,40);e.reason=cleanReason(j.reason);if(typeof j.crypt==='boolean')e.crypt=j.crypt;
      if(typeof j.choice!=='string'||!names.includes(j.choice)||typeof j.crypt!=='boolean'){reject(a,'townPlan','not in options',j,e);return}
      if(e.outcome!=='pending')return; // the hero already left; recorded, not parked
      park(e,{choice:j.choice,crypt:j.crypt})})}
  else{if(a.lvl<7)return;
    sent_=ask(a,'cryptCall',{},(j,e)=>{e.reason=cleanReason(j.reason);if(typeof j.crypt==='boolean'){e.crypt=j.crypt;e.choice=j.crypt?'answer':'decline'}
      if(typeof j.crypt!=='boolean'){reject(a,'cryptCall','not a yes or no',j,e);return}
      if(e.outcome!=='pending')return;
      park(e,{choice:null,crypt:j.crypt})})}
  if(sent_&&old&&!old.used)settle(mindGet(a,old.mid),'superseded',{error:'replaced by a newer plan'})}

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

// ---- decision point: say (issue #71: in the moment or not at all) ----
// Called from chat.js when an AI hero is about to speak on a trigger. Asks for a line (per-hero
// gap and hourly cap apply). The answer is parked in 'ready' and spoken by sayTick on the next
// step as a follow-up line if it is still fresh and fits the situation, else settled 'late'.
// Returns 'held' when the table line (text) is held back for CFG.sayFresh (aiQuietTable),
// null when the caller should say the table line now.
// Situational triggers must still be in the same state family with the same, living target.
const SIT_TRIGGERS={spot:1,flee:1,duel:1,fight:1};
const fam=s=>s==='assist'?'fight':s;
const sitTarget=(a,trigger)=>trigger==='flee'?a.spotTgt:a.target; // flee: goHome cleared a.target
function situation(a,trigger){if(!SIT_TRIGGERS[trigger])return null;const t=sitTarget(a,trigger);return {fam:fam(a.state),tgt:t?t.id:null}}
const gone=t=>!t||(t.kind==='hero'?t.state==='dead':t.alive===false);
const sameSituation=(a,trigger,sit)=>{if(!sit)return true;const t=sitTarget(a,trigger);return fam(a.state)===sit.fam&&!!t&&t.id===sit.tgt&&!gone(t)};
const canSpeak=a=>a.state!=='dead'&&a.state!=='ghost'&&!a.hidden;
export function brainLine(a,trigger,ctx,text){if(!a.brain||!SAY_TRIGGERS[trigger]||S.brainOn===false)return null;
  if(lastSay.has(a.id)&&clk-lastSay.get(a.id)<CFG.sayGap)return null;
  if(!TH.sayOk(a))return null; // speed-aware cap, per hero and global (#117)
  lastSay.set(a.id,clk);
  const flat={};for(const k in ctx||{})if(typeof ctx[k]!=='object')flat[k]=clip(ctx[k],30);
  const t0=clk,sit=situation(a,trigger);
  if(!ask(a,'say',{trigger,ctx:flat},(j,e)=>{const t=cleanLine(j.line);if(typeof j.line==='string')e.line=clip(j.line,120);
    if(!t){reject(a,'say','bad line',j,e);return}
    const prev=ready.get(a.id);if(prev&&prev.mid!==e.id)settle(mindGet(a,prev.mid),'superseded',{error:'replaced by a newer line'});
    ready.set(a.id,{text:t,mid:e.id,trigger,t0,sit})}))return null;
  if(!CFG.aiQuietTable||typeof text!=='string')return null;
  held.set(a.id,{text,trigger,mid:a.mind[0].id,until:clk+CFG.sayFresh});return 'held'}
// Every step: speak fresh model lines, settle stale ones, release held table lines whose
// window ran out or whose request ended without a line. Only AI heroes ever have entries.
function sayTick(){
  for(const [id,r] of ready){ready.delete(id);const a=S.agents.find(x=>x.id===id),e=a&&mindGet(a,r.mid);
    if(!a||!e||e.outcome!=='pending')continue;
    const why=!a.brain||!canSpeak(a)?'the hero could no longer speak':clk-r.t0>CFG.sayFresh?'came after the moment passed':!sameSituation(a,r.trigger,r.sit)?'the situation changed':null;
    if(why){stats.dropped++;settle(e,'late',{error:why});continue}
    const h=held.get(id);if(h&&h.mid===r.mid)held.delete(id);
    speak(a,r.text,r.trigger,modelTag(e)||true);stats.applied.say++;settle(e,'applied')}
  for(const [id,h] of held){const a=S.agents.find(x=>x.id===id),e=a&&mindGet(a,h.mid);
    if(a&&e&&e.outcome==='pending'&&clk<h.until)continue;
    held.delete(id);if(a&&canSpeak(a))speak(a,h.text,h.trigger,false)}}

// ---- once per step (sim/index.js): clock and plan prefetch for the few AI heroes ----
export function brainTick(dt){clk+=dt;TH.tick(dt);if(ready.size||held.size)sayTick();const l=S.brainHeroes;if(!l||!l.length)return;
  acc+=dt;if(acc<1)return;acc=0;
  for(const id of l.slice()){const a=S.agents.find(x=>x.id===id);
    if(!a||a.state==='dead'){if(a)disableBrain(a);else S.brainHeroes=S.brainHeroes.filter(i=>i!==id);continue}
    if(a.state==='town'&&a.townStep<2){const p=a.brainPlan&&a.brainPlan.town;if(!p||p.used||p.t>clk||clk-p.t>CFG.planTtl)askTown(a)}
    mindSweep(a)}}
