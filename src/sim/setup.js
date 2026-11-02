// New World setup (issue #133): the choices behind the setup page, as plain data, and how a fresh
// world turns them into heroes. Owned by ai-designer. DOM-free, so the page, the headless tests and
// the opening all use the same rules.
//
// A setup is {v, world, seed, fac, name?, slots:{tank,healer,dps1,dps2,dps3: {cls, name?, race?, mind}}, dm:{mode, provider?, model?}}
//   mind  {mode:'agent', provider:'anthropic'|'ollama'|'openai', model}: an agent runner plays the hero through
//         the game tools (the model is what its runner is started with). The Fellowship is always agent-played
//         (hard rule, #148): a member has no scripted or AI mind; an older setup's are turned into agents.
//   dm    {mode:'scripted'} or {mode:'agent', provider, model}: the DM seat is opened and a DM runner started
//   race  a people id of the faction (data/races.js) or absent for "whoever the recruits are"
// validateSetup(s) lists what is wrong (empty = fine); init({setup}) builds the world (sim/opening.js):
// the chosen classes, names and peoples at level 1 in the hall, minds set before the first tick, and the
// same world for the same seed.
import {rnd,pickA} from '../core/rng.js';
import {RACES,racesOf,homeOf} from '../data/races.js';
import {FAC} from '../data/factions.js';
import {S} from './state.js';
import {SLOTS,SLOT_KEYS} from './fellowship.js';
import {makeHero} from './heroes.js';
import {rollScores} from './abilities.js';
import {disableBrain,MIND_PROVIDERS} from './brain.js';
import {markPlayer} from './player.js';
import {setDmSeat} from './dmagent.js';
import {PROF,MAX_PROF} from '../data/professions.js';
import {seedProfs} from './professions.js';

export const SETUP_VERSION=1;
export const CLAUDE_MODELS={haiku:'claude-haiku-5-5',sonnet:'claude-sonnet-5-5'};
export const SETUP_PROVIDERS=['anthropic','ollama','openai']; // what the runners can start with
export const MIND_MODES=['agent']; // a member's mind (#148); the DM may still be scripted (DM_MODES)
export const DM_MODES=['scripted','agent'];
const MODEL_OK=/^[A-Za-z0-9][\w.:\/+-]{0,99}$/;
export const slotLabel=k=>(SLOTS.find(s=>s.key===k)||{}).label||k;
export const slotClasses=k=>((SLOTS.find(s=>s.key===k)||{}).cls||[]).slice();

const SCRIPTED={mode:'scripted'};
export const claudeMind=(mode,which='haiku')=>({mode,provider:'anthropic',model:CLAUDE_MODELS[which]});

// The default: a Concord-or-Warband Fellowship of one of each preferred class, every member an agent on
// Claude Haiku (#148), the DM scripted.
export const DEFAULT_MIND=()=>claudeMind('agent','haiku');
export function defaultSetup(seed=1,world='eldmoor',fac=0){
  const cls={tank:'Warrior',healer:'Priest',dps1:'Mage',dps2:'Hunter',dps3:'Rogue'},slots={};
  for(const k of SLOT_KEYS)slots[k]={cls:cls[k],mind:DEFAULT_MIND()};
  return {v:SETUP_VERSION,world,seed:seed>>>0,fac,slots,dm:{...SCRIPTED}}}

// ---- presets ----
// ctx: {local} the one local model the relay has loaded (or the first pulled), '' when none; {last} the
// viewer's last used setup. Returns a copy of base with the minds replaced, or null when the preset
// cannot be made (no local model, no last setup). There is no "all scripted" preset (#148): the members are
// always agents; 'haiku' keeps the DM scripted, the cheapest way to play.
export const PRESETS=['haiku','claude','local','last'];
export function applyPreset(name,base,ctx={}){const s=JSON.parse(JSON.stringify(base)),all=m=>{for(const k of SLOT_KEYS)s.slots[k].mind={...m}};
  if(name==='haiku'){all(claudeMind('agent','haiku'));s.dm={...SCRIPTED};return s}
  if(name==='claude'){all(claudeMind('agent','haiku'));s.dm=claudeMind('agent','sonnet');return s}
  if(name==='local'){if(!ctx.local)return null;all({mode:'agent',provider:'ollama',model:ctx.local});s.dm={mode:'agent',provider:'ollama',model:ctx.local};return s}
  if(name==='last'){const l=ctx.last;if(!l||!l.slots)return null;
    for(const k of SLOT_KEYS)if(l.slots[k]&&l.slots[k].mind)s.slots[k]={...s.slots[k],mind:agentOnly(l.slots[k].mind)};
    if(l.dm)s.dm={...l.dm};
    // the viewer's last Fellowship, kept whole when it is of the same faction
    if(l.fac===s.fac)for(const k of SLOT_KEYS)if(l.slots[k]){const {cls,name,race,profs}=l.slots[k];s.slots[k]={...s.slots[k],cls,...(name?{name}:{}),...(race?{race}:{}),...(profs&&profs.length?{profs:profs.slice()}:{})}}
    return s}
  return null}

// A remembered member mind as an agent mind: an older AI mind keeps its model, a scripted one becomes the
// default agent (#148).
function agentOnly(m){if(m&&(m.mode==='agent'||m.mode==='ai')&&m.provider&&m.model)return {mode:'agent',provider:m.provider,model:m.model};return DEFAULT_MIND()}

// ---- checking ----
function mindProblem(m,what,modes=MIND_MODES){if(!m||typeof m!=='object'||!modes.includes(m.mode))return what+(modes===MIND_MODES&&m&&(m.mode==='scripted'||m.mode==='ai')?': a Fellowship member is always played by an agent; pick its model.':': unknown mind.');
  if(m.mode==='scripted')return null;
  if(!SETUP_PROVIDERS.includes(m.provider)||!MIND_PROVIDERS.includes(m.provider))return what+': pick a provider for the '+(m.mode==='ai'?'AI':'agent')+'.';
  if(typeof m.model!=='string'||!MODEL_OK.test(m.model))return what+': there is no model for the '+(m.mode==='ai'?'AI':'agent')+'; pick one'+(m.provider==='ollama'?' (is Ollama running with a model pulled?)':'')+'.';
  return null}
export function validateSetup(s){const out=[];
  if(!s||typeof s!=='object')return ['No setup.'];
  if(!FAC[s.fac])out.push('Pick a faction.');
  if(!(Number.isInteger(s.seed)&&s.seed>=0))out.push('The seed must be a whole number.');
  const seen=new Set();
  for(const sl of SLOTS){const p=s.slots&&s.slots[sl.key];
    if(!p){out.push(sl.label+': missing.');continue}
    if(!sl.cls.includes(p.cls))out.push(sl.label+': '+p.cls+' cannot fill this place ('+sl.cls.join(' or ')+').');
    if(p.race&&!racesOf(s.fac).some(r=>r.id===p.race))out.push(sl.label+': that people is not of the '+(FAC[s.fac]?FAC[s.fac].name:'faction')+'.');
    if(p.name!=null&&p.name!==''){const n=String(p.name).trim();
      if(n.length<2||n.length>24||!/^[\p{L}][\p{L}' -]*$/u.test(n))out.push(sl.label+': a name is 2-24 letters (spaces, hyphens and apostrophes allowed).');
      else if(seen.has(n.toLowerCase()))out.push(sl.label+': "'+n+'" is used twice.');else seen.add(n.toLowerCase())}
    if(p.profs!=null){if(!Array.isArray(p.profs)||p.profs.length>MAX_PROF||p.profs.some(id=>!PROF[id])||new Set(p.profs).size!==p.profs.length)out.push(sl.label+': pick up to '+MAX_PROF+' different professions, or let them choose.')}
    const mp=mindProblem(p.mind,sl.label);if(mp)out.push(mp)}
  if(!s.dm||!DM_MODES.includes(s.dm.mode))out.push('DM: pick scripted or agent.');
  else if(s.dm.mode==='agent'){const mp=mindProblem({...s.dm},'DM',DM_MODES);if(mp)out.push(mp)}
  return out}

// Strip a setup to the fields we read (it may come from localStorage or the URL of an older page).
export function cleanSetup(s){if(!s||typeof s!=='object')return null;
  const m=agentOnly; // members: agents only (#148); an older page's scripted or AI mind becomes an agent
  const slots={};for(const k of SLOT_KEYS){const p=(s.slots&&s.slots[k])||{};slots[k]={cls:p.cls,...(p.name?{name:String(p.name).trim()}:{}),...(p.race?{race:p.race}:{}),...(Array.isArray(p.profs)&&p.profs.length?{profs:[...new Set(p.profs)].filter(id=>PROF[id]).slice(0,MAX_PROF)}:{}),mind:m(p.mind)}}
  const dm=s.dm&&s.dm.mode==='agent'?{mode:'agent',provider:s.dm.provider,model:s.dm.model}:{mode:'scripted'};
  return {v:SETUP_VERSION,world:s.world||'eldmoor',seed:s.seed>>>0,fac:s.fac|0,...(s.name?{name:String(s.name).trim().slice(0,40)}:{}),slots,dm}}

// ---- names ----
// A name in a people's voice (the same tables as data/races.js, with the caller's dice so a reroll is cheap).
export function suggestName(raceId,u1=rnd(),u2=rnd()){const r=RACES.find(x=>x.id===raceId)||RACES[0],a=r.names[0],b=r.names[1];
  return a[Math.floor(u1*a.length)%a.length]+b[Math.floor(u2*b.length)%b.length]}

// ---- building the Fellowship (called by opening()) ----
const free=(a,fac,used)=>a.kind==='hero'&&a.state!=='dead'&&a.fac===fac&&!a.fellow&&!a.player&&!used.has(a.id);
// Make a level-1 hero of this people: new skin, hair and home town, abilities rolled again.
function restyle(a,raceId){const r=RACES.find(x=>x.id===raceId);if(!r||r.fac!==a.fac||a.race===r.id)return;
  a.race=r.id;a.skin=pickA(r.skin);a.hair=pickA(r.hair);a.town=r.home;const c=homeOf(a);a.town=c.name;a.x=c.x0+2+rnd()*7;a.y=c.y0+4+rnd()*3;rollScores(a)}

// Slot map {tank:id,...} for found(): for each place a level-1 recruit of the chosen class (and people, when
// one of the roster already is), else a fresh newcomer made to fit; then the chosen names and peoples.
export function pickSetup(setup){const used=new Set(),pick={},fac=setup.fac;
  const taken=new Set(S.agents.map(a=>a.name.toLowerCase()));
  for(const sl of SLOTS){const p=setup.slots[sl.key];
    const pool=S.agents.filter(a=>free(a,fac,used)&&a.cls===p.cls).sort((x,y)=>x.id-y.id);
    let a=(p.race&&pool.find(x=>x.race===p.race))||pool[0];
    if(!a)a=makeHero(fac,p.cls,null,0);
    used.add(a.id);pick[sl.key]=a.id;
    if(p.race)restyle(a,p.race);
    if(p.name){let n=p.name;if(n.toLowerCase()!==a.name.toLowerCase()&&taken.has(n.toLowerCase()))n+=' II';taken.delete(a.name.toLowerCase());taken.add(n.toLowerCase());a.name=n}}
  return pick}

// Minds, set before the first tick: every member is agent-played at once (found() already marked them: AGENT
// with a link state, autopilot and reflexes until a runner claims it), the DM seat opens when the DM is an agent.
// The model each member's runner starts with is in the setup (planRunners); the page starts them.
export function applyMinds(setup){const F=S.fellowship;if(!F)return;
  const mem=SLOT_KEYS.map(k=>[k,F.slots[k]!=null?S.agents.find(a=>a.id==F.slots[k]):null]);
  for(const [k,a] of mem){if(!a)continue;
    if(a.brain){disableBrain(a);delete a.fellowBrain}
    if(!a.player&&markPlayer(a,true))a.fellowAgent=true}
  const chosen={};for(const [k,a] of mem){const ids=setup.slots[k]&&setup.slots[k].profs;if(a&&ids&&ids.length){chosen[k]=ids.slice();seedProfs(a,ids)}}
  F.minds='agent';F.ai=true;
  if(setup.dm&&setup.dm.mode==='agent')setDmSeat(true);
  return chosen} // {slot:[profession ids]} the owner chose; kept in S.setup.profs for whoever fills a place later

// ---- which runners a setup needs ----
// One Fellowship runner when all five are agents on the same mind, else one hero runner per agent member;
// plus the DM's runner. [{kind:'fellowship'|'hero'|'dm', slot?, provider, model, label}]. The page starts
// them through the relay (src/ui/setup.js); the relay says how many may run at once.
export function planRunners(setup){const out=[],ag=SLOT_KEYS.filter(k=>setup.slots[k].mind.mode==='agent'),m0=ag.length?setup.slots[ag[0]].mind:null;
  if(ag.length===SLOT_KEYS.length&&ag.every(k=>setup.slots[k].mind.provider===m0.provider&&setup.slots[k].mind.model===m0.model))
    out.push({kind:'fellowship',provider:m0.provider,model:m0.model,label:'the Fellowship'});
  else for(const k of ag){const m=setup.slots[k].mind;out.push({kind:'hero',slot:k,provider:m.provider,model:m.model,label:slotLabel(k)+(k.startsWith('dps')?' '+k.slice(3):'')})}
  if(setup.dm&&setup.dm.mode==='agent')out.push({kind:'dm',provider:setup.dm.provider,model:setup.dm.model,label:'the DM'});
  return out}
