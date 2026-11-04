// New World setup (issue #133; v2 #453, epic #402): the choices behind the setup page, as plain data, and how a
// fresh world turns them into heroes. Owned by ai-designer. DOM-free, so the page, the headless tests and the
// opening all use the same rules.
//
// A setup (v2) is
//   {v:2, world, seed, mode:'together'|'apart', fac, name?, hall?,
//    heroes:[{cls, name?, race?, fac, mind, profs?, archetype?, start?:{town?, region?}, group?}],   // 1..MAX_HEROES
//    dm:{mode, provider?, model?}}
//   mode  'together' (the default, permanently; owner decision 3 on #402): one company of every hero in one hall,
//         the classic five-place Fellowship (a Tank, a Healer, three DPS, in any order), all of one faction (`fac`);
//         `start` and `group` are ignored. A New World with no choices plays exactly as before v2.
//   hall  together only (#771): the town of `fac` the company founds its hall in, every member standing there from the
//         first tick whatever their people's home town. Absent = the Tank's home town, as ever.
//         'apart': every hero sets out from its own start town (`start.town`: a town of its faction, or 'home' /
//         absent for its people's home town), at level 1 in town, or seasoned to the low end of `start.region`'s
//         band and out hunting there. Heroes sharing a `group` ride as one company (the first member's start is the
//         group's); a hero with no group is a company of one (a solo). Each company is of one faction; the world
//         may hold both.
//   fac   the together faction; for apart the default of a hero with none
//   mind  {mode:'agent', provider:'anthropic'|'ollama'|'openai'|'huggingface'|'google', model}: an agent runner plays the hero through
//         the game tools (the model is what its runner is started with). Agent heroes are always agent-played
//         (hard rule, #148): a hero has no scripted or AI mind; an older setup's are turned into agents.
//   dm    {mode:'agent', provider, model}: the DM is always an agent (owner decision on #520, slice A #559): the DM seat
//         is open from the first tick and a DM runner is started with this mind. There is no scripted-DM mode: the
//         scripted DM is the world engine and the DM's reflexes. An older setup's {mode:'scripted'} DM cleans to the
//         default DM agent (cleanSetup), and validateSetup refuses it.
//   race  a people id of the hero's faction (data/races.js) or absent for "whoever the recruits are"
//   archetype  an id of data/archetypes.js, 'random' (picked from the seed and the hero's index, no RNG) or absent
// A v1 setup ({fac, slots:{tank,healer,dps1,dps2,dps3}}, the page before #453, the viewer's last setup) migrates to
// v2 together with the heroes in SLOT_KEYS order (cleanSetup / asV2), so it builds the same world as before.
// validateSetup(s) lists what is wrong (empty = fine); init({setup}) builds the world (sim/opening.js) with minds
// set before the first tick, and the same world for the same seed.
import {rnd,pickA} from '../core/rng.js';
import {RACES,racesOf,homeOf} from '../data/races.js';
import {FAC} from '../data/factions.js';
import {CLS} from '../data/classes.js';
import {CITY,REGIONS} from '../world/map.js';
import {WORLDS} from '../world/spec.js';
import {S} from './state.js';
import {makeHero} from './heroes.js';
import {rollScores} from './abilities.js';
import {disableBrain,MIND_PROVIDERS} from './brain.js';
import {markPlayer} from './player.js';
import {setDmSeat} from './dmagent.js';
import {PROF,MAX_PROF} from '../data/professions.js';
import {seedProfs} from './professions.js';
import {hash} from '../core/rng.js';
import {ARCHETYPES,ARCHETYPE_IDS} from '../data/archetypes.js';
import {applyArchetype} from './persona.js';
import {inSlots,slotted,SLOTS,SLOT_KEYS} from './company.js'; // the slotted company (#588)

export const SETUP_VERSION=2;
export const MODES=['together','apart'];
// Seats (#455, #402 decision 6): agent heroes in the world, the DM outside the count. Five when any mind is paid
// (Claude or OpenAI), up to ten when every mind is local (Ollama). MAX_HEROES is the most any setup may hold.
export const SEATS={PAID:5,LOCAL:10};
export const MAX_HEROES=SEATS.LOCAL;
const isLocal=m=>!!m&&m.provider==='ollama';
export function seatCap(s0){const H=s0&&Array.isArray(s0.heroes)?s0.heroes:[];return H.length&&H.every(h=>h&&isLocal(h.mind))?SEATS.LOCAL:SEATS.PAID}
// The turn-time warning shown when more than five local minds share one GPU ('' when not needed).
export function seatNote(s0){const H=s0&&Array.isArray(s0.heroes)?s0.heroes:[];
  return H.length>SEATS.PAID&&seatCap(s0)===SEATS.LOCAL?H.length+' local minds share one GPU: each agent turn will be slow (expect long waits between turns).':''}
export const CLAUDE_MODELS={haiku:'claude-haiku-5-5',sonnet:'claude-sonnet-5-5'};
export const SETUP_PROVIDERS=['anthropic','ollama','openai','huggingface','google']; // what the runners can start with
export const MIND_MODES=['agent']; // a hero's mind (#148)
export const DM_MODES=['agent']; // the DM's mind (#520): always an agent
export const ARCHETYPE_RANDOM='random';
export const CLASSIC=['Warrior','Priest','Mage','Hunter','Rogue']; // the classic five, in SLOT_KEYS order
const archOk=v=>v===ARCHETYPE_RANDOM||!!ARCHETYPES[v];
const MODEL_OK=/^[A-Za-z0-9][\w.:\/+-]{0,99}$/;
export const slotLabel=k=>(SLOTS.find(s=>s.key===k)||{}).label||k;
export const slotClasses=k=>((SLOTS.find(s=>s.key===k)||{}).cls||[]).slice();
const clone=o=>JSON.parse(JSON.stringify(o));

export const claudeMind=(mode,which='haiku')=>({mode,provider:'anthropic',model:CLAUDE_MODELS[which]});
export const DEFAULT_MIND=()=>claudeMind('agent','haiku');
export const DEFAULT_DM=()=>claudeMind('agent','haiku'); // the cheapest DM agent; the 'claude' preset seats Sonnet

// ---- v1 -> v2 ----
// The raw migration (values kept as they are, so validateSetup still sees a bad value): slots -> heroes in
// SLOT_KEYS order, mode together. A v2 setup passes through.
export function asV2(s){if(!s||typeof s!=='object'||Array.isArray(s.heroes)||!s.slots)return s;
  const {slots,v,...rest}=s;
  return {...rest,v:SETUP_VERSION,mode:'together',heroes:SLOT_KEYS.map(k=>slots[k]?{...slots[k],fac:s.fac}:null)}}
// Which hero takes which place of the five ({tank:i, healer:i, dps1:i, ...}), or null when the heroes are not the
// five places (a together setup must be). Heroes in order, each to the first free place its class fits, so a v1
// setup maps back to its own slots.
export function slotsOf(s){s=asV2(s);const H=s&&Array.isArray(s.heroes)?s.heroes:null;if(!H||H.length!==SLOT_KEYS.length)return null;
  const map={};for(let i=0;i<H.length;i++){const h=H[i];if(!h)return null;const sl=SLOTS.find(x=>map[x.key]==null&&x.cls.includes(h.cls));if(!sl)return null;map[sl.key]=i}
  return SLOT_KEYS.every(k=>map[k]!=null)?map:null}
// The v1 editing shape of a together setup of the five (the setup page edits places until #454), or null.
export function slotsView(s){s=asV2(s);if(!s||s.mode==='apart')return null;const map=slotsOf(s);if(!map)return null;
  const slots={};for(const k of SLOT_KEYS){const {fac,start,group,...h}=s.heroes[map[k]];slots[k]=clone(h)}
  return {v:1,world:s.world,seed:s.seed,fac:s.fac,...(s.name?{name:s.name}:{}),...(s.hall?{hall:s.hall}:{}),slots,dm:clone(s.dm||DEFAULT_DM())}}

// The archetype a hero gets: the chosen id, or for 'random' one picked from the seed and the hero's index (a hash,
// so the world's random stream is untouched and the same seed gives the same picks). null = none.
// k: the hero's index (a slot key of the five is still understood: its hero's index).
export function resolveArchetype(setup,k){const s=asV2(setup);if(!s||!Array.isArray(s.heroes))return null;
  let i=k;if(typeof k==='string'){const m=slotsOf(s);i=m&&m[k]!=null?m[k]:SLOT_KEYS.indexOf(k)}
  const v=i>=0&&s.heroes[i]&&s.heroes[i].archetype;if(!v)return null;
  if(v!==ARCHETYPE_RANDOM)return ARCHETYPES[v]?v:null;
  return ARCHETYPE_IDS[Math.floor(hash(i+1,295,(s.seed>>>0)%2147483647)*ARCHETYPE_IDS.length)%ARCHETYPE_IDS.length]}

// The default: a Concord-or-Warband Fellowship of one of each preferred class, together, every hero an agent on
// Claude Haiku (#148), the DM an agent on Claude Haiku too (#520).
export function defaultSetup(seed=1,world='eldmoor',fac=0){
  return {v:SETUP_VERSION,world,seed:seed>>>0,mode:'together',fac,heroes:CLASSIC.map(cls=>({cls,fac,mind:DEFAULT_MIND()})),dm:DEFAULT_DM()}}

// ---- presets ----
// Shape presets set who sets out and how: 'classic' (the five together, the default), 'five-solos' (the same five,
// apart, each alone in its people's home town, level 1), 'pairs-and-solo' (apart: Warrior and Priest, Mage and
// Hunter, the Rogue alone), 'solo' (one hero, apart). They keep a hero's choices and mind when its class matches.
// Mind presets set the minds: 'haiku' (every hero and the DM on Claude Haiku: the cheapest), 'claude' (DM on
// Sonnet), 'local' (one local model for all), 'last' (the viewer's last setup).
// ctx: {local} the one local model the relay has loaded (or the first pulled), '' when none; {last} the viewer's
// last used setup (v1 or v2). Returns a v2 copy of base, or null when the preset cannot be made (no local model, no
// last setup). There is no "all scripted" preset (#148).
export const SHAPE_PRESETS=['classic','five-solos','pairs-and-solo','solo'];
export const MIND_PRESETS=['haiku','claude','local','last'];
export const PRESETS=[...SHAPE_PRESETS,...MIND_PRESETS];
const PAIRS=[1,1,2,2,null]; // groups of the classic five for 'pairs-and-solo'
function shaped(s,mode,n,groups){const old=s.heroes||[],fac=s.fac|0;
  s.mode=mode;if(mode==='apart')delete s.hall;s.heroes=CLASSIC.slice(0,n).map((cls,i)=>{const o=old[i]&&old[i].cls===cls&&(old[i].fac==null||old[i].fac===fac)?old[i]:{cls};
    const {start,group,...h}=clone(o);h.fac=fac;h.mind=agentOnly(old[i]&&old[i].mind);
    if(mode==='apart'){h.start={town:'home'};if(groups&&groups[i]!=null)h.group=groups[i]}
    return h});
  return s}
export function applyPreset(name,base,ctx={}){const b=asV2(base);if(!b||!Array.isArray(b.heroes))return null;
  const s=clone(b),all=m=>{for(const h of s.heroes)h.mind={...m}};s.v=SETUP_VERSION;if(!s.mode)s.mode='together';
  if(name==='classic')return shaped(s,'together',5);
  if(name==='five-solos')return shaped(s,'apart',5);
  if(name==='pairs-and-solo')return shaped(s,'apart',5,PAIRS);
  if(name==='solo')return shaped(s,'apart',1);
  if(name==='haiku'){all(claudeMind('agent','haiku'));s.dm=DEFAULT_DM();return s}
  if(name==='claude'){all(claudeMind('agent','haiku'));s.dm=claudeMind('agent','sonnet');return s}
  if(name==='local'){if(!ctx.local)return null;all({mode:'agent',provider:'ollama',model:ctx.local});s.dm={mode:'agent',provider:'ollama',model:ctx.local};return s}
  if(name==='last'){const l=cleanSetup(ctx.last);if(!l||!l.heroes.length)return null;
    if(l.dm)s.dm={...l.dm}; // cleanSetup: always an agent
    // the viewer's last heroes, kept whole when of the same faction (or apart); else only their minds, by index
    if(l.mode==='apart'||l.fac===s.fac){s.mode=l.mode;s.fac=l.fac;s.heroes=clone(l.heroes);if(l.name)s.name=l.name;else delete s.name;if(l.hall)s.hall=l.hall;else delete s.hall;return s}
    s.heroes.forEach((h,i)=>{if(l.heroes[i])h.mind={...l.heroes[i].mind}});
    return s}
  return null}

// A remembered hero mind as an agent mind: an older AI mind keeps its model, a scripted one becomes the
// default agent (#148).
function agentOnly(m){if(m&&(m.mode==='agent'||m.mode==='ai')&&m.provider&&m.model)return {mode:'agent',provider:m.provider,model:m.model};return DEFAULT_MIND()}

// ---- checking ----
function mindProblem(m,what,modes=MIND_MODES){if(!m||typeof m!=='object'||!modes.includes(m.mode))return what+(m&&(m.mode==='scripted'||m.mode==='ai')?(modes===DM_MODES?': the DM is always an agent; pick its model.':': a Fellowship member is always played by an agent; pick its model.'):': unknown mind.');
  if(!SETUP_PROVIDERS.includes(m.provider)||!MIND_PROVIDERS.includes(m.provider))return what+': pick a provider for the '+(m.mode==='ai'?'AI':'agent')+'.';
  if(typeof m.model!=='string'||!MODEL_OK.test(m.model))return what+': there is no model for the '+(m.mode==='ai'?'AI':'agent')+'; pick one'+(m.provider==='ollama'?' (is Ollama running with a model pulled?)':'')+'.';
  return null}
const townOf=(name,fac)=>CITY.find(c=>c.name===name&&c.fac===fac)||null;
// The towns a together company of this faction may found its hall in (#771), from the world spec: the page may be choosing
// for another map than the one it stands on.
export const hallTowns=(world,fac)=>((WORLDS[world]||{}).towns||CITY).filter(t=>t.fac===fac).map(t=>t.name);
// The hall a setup chose, when it is a town of this world (undefined: the leader's home town, as ever).
export const hallOf=s=>s&&s.hall&&townOf(s.hall,s.fac)?s.hall:undefined;
const regionOf=name=>{const i=REGIONS.findIndex(r=>r.name===name);return i<0?null:{i,r:REGIONS[i]}};
const facOf=(s,h)=>h&&h.fac!=null?h.fac:s.fac;
// The companies a setup founds, as lists of hero indexes: together one of all; apart one per group (in order of
// first appearance) and one per hero with no group.
export function groupsOf(s){s=asV2(s);const H=s&&Array.isArray(s.heroes)?s.heroes:[];if(s.mode!=='apart')return H.length?[H.map((h,i)=>i)]:[];
  const out=[],by=new Map();
  H.forEach((h,i)=>{const g=h&&h.group!=null&&h.group!==''?String(h.group):null;
    if(g==null){out.push([i]);return}if(!by.has(g)){by.set(g,[]);out.push(by.get(g))}by.get(g).push(i)});
  return out}
// What is wrong with the together shape (null when the heroes are the five places).
function togetherProblem(H){if(H.length!==SLOTS.length)return 'Together rides as the five for now: a Tank, a Healer and three DPS ('+H.length+' chosen). Pick Apart for fewer.';
  for(const h of H){const sl=h&&SLOTS.find(x=>x.cls.includes(h.cls));if(!sl)continue;
    const same=H.filter(x=>x&&sl.cls.includes(x.cls)).length,want=SLOTS.filter(x=>x.role===sl.role).length;
    if(same>want)return 'Together: '+same+' heroes for '+want+' '+sl.label+' place'+(want>1?'s':'')+' ('+h.cls+' cannot fill another place; the Tank is a Warrior, the Healer a '+SLOTS[1].cls.join(' or ')+').'}
  return 'Together needs a Tank (Warrior), a Healer ('+SLOTS[1].cls.join(' or ')+') and three DPS.'}
export function validateSetup(s0){const out=[];
  if(!s0||typeof s0!=='object')return ['No setup.'];
  const s=asV2(s0),H=Array.isArray(s.heroes)?s.heroes:null,mode=s.mode==null?'together':s.mode;
  if(!MODES.includes(mode))out.push('Pick Together or Apart.');
  if(!(Number.isInteger(s.seed)&&s.seed>=0))out.push('The seed must be a whole number.');
  if(mode!=='apart'&&!FAC[s.fac])out.push('Pick a faction.');
  else if(mode!=='apart'&&s.hall&&!hallTowns(s.world,s.fac).includes(s.hall))out.push('The hall: '+s.hall+' is not a town of the '+FAC[s.fac].name+'.');
  if(!H||!H.length)return out.concat(['Pick at least one hero.']);
  if(H.length>MAX_HEROES)out.push('At most '+MAX_HEROES+' heroes.');
  else if(H.length>seatCap(s))out.push('Seats full: '+H.length+' heroes, but only '+SEATS.PAID+' agent heroes may play while any mind is paid (Claude or OpenAI). Up to '+SEATS.LOCAL+' when every hero uses a local model.');
  const map=mode==='together'?slotsOf(s):null,place={};if(map)for(const k in map)place[map[k]]=k;
  if(mode==='together'&&!map)out.push(togetherProblem(H));
  const label=i=>{const h=H[i]||{};if(place[i])return slotLabel(place[i]);return 'Hero '+(i+1)+(h.name?' ('+String(h.name).trim()+')':h.cls?' ('+h.cls+')':'')};
  const seen=new Set();
  for(let i=0;i<H.length;i++){const h=H[i],L=label(i);
    if(!h||typeof h!=='object'){out.push(L+': missing.');continue}
    const fac=facOf(s,h);
    if(!FAC[fac])out.push(L+': pick a faction.');
    else if(mode==='together'&&fac!==s.fac)out.push(L+': a company is of one faction; Together needs every hero of the '+(FAC[s.fac]?FAC[s.fac].name:'same faction')+'.');
    if(!CLS[h.cls])out.push(L+': pick a class.');
    if(h.race&&FAC[fac]&&!racesOf(fac).some(r=>r.id===h.race))out.push(L+': that people is not of the '+FAC[fac].name+'.');
    if(h.name!=null&&h.name!==''){const n=String(h.name).trim();
      if(n.length<2||n.length>24||!/^[\p{L}][\p{L}' -]*$/u.test(n))out.push(L+': a name is 2-24 letters (spaces, hyphens and apostrophes allowed).');
      else if(seen.has(n.toLowerCase()))out.push(L+': "'+n+'" is used twice.');else seen.add(n.toLowerCase())}
    if(h.profs!=null){if(!Array.isArray(h.profs)||h.profs.length>MAX_PROF||h.profs.some(id=>!PROF[id])||new Set(h.profs).size!==h.profs.length)out.push(L+': pick up to '+MAX_PROF+' different professions, or let them choose.')}
    if(h.archetype!=null&&h.archetype!==''&&!archOk(h.archetype))out.push(L+': unknown archetype; pick one, Random or None.');
    if(mode==='apart'&&h.start!=null){const st=h.start;
      if(typeof st!=='object')out.push(L+': unknown start.');
      else{if(st.town!=null&&st.town!==''&&st.town!=='home'&&FAC[fac]&&!townOf(st.town,fac))out.push(L+': '+st.town+' is not a town of the '+FAC[fac].name+'.');
        if(st.region!=null&&st.region!==''&&!regionOf(st.region))out.push(L+': there is no region called '+st.region+'.')}}
    const mp=mindProblem(h.mind,L);if(mp)out.push(mp)}
  if(mode==='apart')for(const g of groupsOf(s))if(g.length>1&&new Set(g.map(i=>facOf(s,H[i]))).size>1)out.push('Group '+H[g[0]].group+': a company is of one faction.');
  if(!s.dm||typeof s.dm!=='object')out.push('DM: pick the model that plays the DM.');
  else{const mp=mindProblem({...s.dm},'DM',DM_MODES);if(mp)out.push(mp)}
  return out}

// Strip a setup to the fields we read (it may come from localStorage or the URL of an older page); a v1 setup comes
// back as v2 together.
export function cleanSetup(s0){if(!s0||typeof s0!=='object')return null;const s=asV2(s0);
  const mode=MODES.includes(s.mode)?s.mode:'together',fac=s.fac|0;
  const heroes=(Array.isArray(s.heroes)?s.heroes:[]).slice(0,MAX_HEROES).map(p=>{p=p&&typeof p==='object'?p:{};
    const hf=mode==='together'||p.fac==null?fac:p.fac|0,st=p.start&&typeof p.start==='object'?p.start:null;
    const start=mode==='apart'&&st?{...(st.town?{town:String(st.town)}:{}),...(st.region?{region:String(st.region)}:{})}:null;
    return {cls:p.cls,...(p.name?{name:String(p.name).trim()}:{}),...(p.race?{race:p.race}:{}),fac:hf,
      ...(Array.isArray(p.profs)&&p.profs.length?{profs:[...new Set(p.profs)].filter(id=>PROF[id]).slice(0,MAX_PROF)}:{}),
      ...(archOk(p.archetype)?{archetype:p.archetype}:{}),
      ...(start&&Object.keys(start).length?{start}:{}),
      ...(mode==='apart'&&p.group!=null&&p.group!==''?{group:typeof p.group==='number'?p.group:String(p.group)}:{}),
      mind:agentOnly(p.mind)}}); // agents only (#148): an older page's scripted or AI mind becomes an agent
  const dm=s.dm&&(s.dm.mode==='agent'||s.dm.mode==='ai')&&s.dm.provider&&s.dm.model?{mode:'agent',provider:s.dm.provider,model:s.dm.model}:DEFAULT_DM(); // the DM is always an agent (#520): an older scripted DM becomes the default
  return {v:SETUP_VERSION,world:s.world||'eldmoor',seed:s.seed>>>0,mode,fac,...(s.name?{name:String(s.name).trim().slice(0,40)}:{}),...(mode==='together'&&s.hall?{hall:String(s.hall)}:{}),heroes,dm}}

// ---- names ----
// A name in a people's voice (the same tables as data/races.js, with the caller's dice so a reroll is cheap).
export function suggestName(raceId,u1=rnd(),u2=rnd()){const r=RACES.find(x=>x.id===raceId)||RACES[0],a=r.names[0],b=r.names[1];
  return a[Math.floor(u1*a.length)%a.length]+b[Math.floor(u2*b.length)%b.length]}

// ---- choosing the heroes (called by opening()) ----
const free=(a,fac,used)=>a.kind==='hero'&&a.state!=='dead'&&a.fac===fac&&!inSlots(a)&&!a.player&&!used.has(a.id);
// Make a level-1 hero of this people: new skin, hair and home town, abilities rolled again.
function restyle(a,raceId){const r=RACES.find(x=>x.id===raceId);if(!r||r.fac!==a.fac||a.race===r.id)return;
  a.race=r.id;a.skin=pickA(r.skin);a.hair=pickA(r.hair);a.town=r.home;const c=homeOf(a);a.town=c.name;a.x=c.x0+2+rnd()*7;a.y=c.y0+4+rnd()*3;rollScores(a)}
// One hero for a setup entry: a level-1 recruit of the chosen class (and people, when one of the roster already
// is), else a fresh newcomer made to fit; then the chosen people and name.
function pickOne(p,fac,used,taken){
  const pool=S.agents.filter(a=>free(a,fac,used)&&a.cls===p.cls).sort((x,y)=>x.id-y.id);
  let a=(p.race&&pool.find(x=>x.race===p.race))||pool[0];
  if(!a)a=makeHero(fac,p.cls,null,0);
  used.add(a.id);
  if(p.race)restyle(a,p.race);
  if(p.name){let n=p.name;if(n.toLowerCase()!==a.name.toLowerCase()&&taken.has(n.toLowerCase()))n+=' II';taken.delete(a.name.toLowerCase());taken.add(n.toLowerCase());a.name=n}
  return a}

// Together: slot map {tank:id,...} for found(), the five places in SLOTS order (the same dice as v1).
export function pickSetup(setup){setup=asV2(setup);const used=new Set(),pick={},fac=setup.fac,map=slotsOf(setup);
  const taken=new Set(S.agents.map(a=>a.name.toLowerCase()));
  for(const sl of SLOTS)pick[sl.key]=pickOne(setup.heroes[map[sl.key]],fac,used,taken).id;
  return pick}
// Apart: one hero per entry, in order: [heroId].
export function pickApart(setup){const used=new Set(),taken=new Set(S.agents.map(a=>a.name.toLowerCase()));
  return setup.heroes.map(h=>pickOne(h,facOf(setup,h),used,taken).id)}

// Minds, set before the first tick: every member is agent-played at once (found() already marked them: AGENT
// with a link state, autopilot and reflexes until a runner claims it), and the DM seat opens (the DM is always an
// agent, #520; the scripted DM answers its calls as reflexes until its runner is there).
// The model each member's runner starts with is in the setup (planRunners); the page starts them.
export function applyMinds(setup){setup=asV2(setup);const F=slotted();if(!F)return;const map=slotsOf(setup)||{};
  const mem=SLOT_KEYS.map(k=>[k,F.slots[k]!=null?S.agents.find(a=>a.id==F.slots[k]):null]);
  for(const [k,a] of mem){if(!a)continue;
    if(a.brain){disableBrain(a);delete a.fellowBrain}
    if(!a.player&&markPlayer(a,true))a.fellowAgent=true}
  const at=k=>map[k]!=null?setup.heroes[map[k]]:null;
  const chosen={};for(const [k,a] of mem){const ids=at(k)&&at(k).profs;if(a&&ids&&ids.length){chosen[k]=ids.slice();seedProfs(a,ids)}}
  for(const [k,a] of mem){const id=a&&resolveArchetype(setup,k);if(id&&applyArchetype(a,id))a.persona.edited=true} // the persona voice the owner chose (#295); marked as the owner's, like the panel picker, so relay writing never replaces it
  F.minds='agent';F.ai=true;
  setDmSeat(true);
  return chosen} // {slot:[profession ids]} the owner chose; kept in S.setup.profs for whoever fills a place later

// Apart: where a hero (entry h) starts. {town (a CITY row of its faction), zone (region index) or null, lvl (the
// region band's low end; 1 = in town)}.
export function startOf(a,h){const st=h&&h.start||{};
  const town=(st.town&&st.town!=='home'&&townOf(st.town,a.fac))||homeOf(a);
  const reg=st.region?regionOf(st.region):null,band=reg&&reg.r.band||[1];
  return {town,zone:reg?reg.i:null,lvl:Math.max(1,band[0]|0)}}

// ---- which runners a setup needs ----
// Together: one Fellowship runner when all five are agents on the same mind, else one hero runner per member (with
// its slot). Apart: per company, one company runner when its members (two or more) share one mind, else one hero
// runner per hero (with its index). Plus the DM's runner, always (#520).
// [{kind:'fellowship'|'company'|'hero'|'dm', slot?, index?, heroes?, provider, model, label}]. The page starts them
// through the relay (src/ui/setup.js); the relay says how many may run at once. (The relay's 'company' kind comes
// with the company runners, #402 slice 12; until then the setup page offers only Together.)
export function planRunners(setup){const s=asV2(setup),out=[],H=s.heroes||[],same=(a,b)=>a.provider===b.provider&&a.model===b.model;
  const nameOf=i=>H[i].name||H[i].cls,isAgent=i=>!!(H[i]&&H[i].mind&&H[i].mind.mode==='agent');
  if(s.mode!=='apart'){const map=slotsOf(s)||{},slotAt={};for(const k in map)slotAt[map[k]]=k;
    const ag=H.map((h,i)=>i).filter(isAgent),m0=ag.length?H[ag[0]].mind:null;
    if(ag.length===H.length&&ag.length===SLOT_KEYS.length&&ag.every(i=>same(H[i].mind,m0)))
      out.push({kind:'fellowship',provider:m0.provider,model:m0.model,label:'the Fellowship'});
    else for(const i of ag){const m=H[i].mind,k=slotAt[i];
      out.push({kind:'hero',...(k?{slot:k}:{}),index:i,provider:m.provider,model:m.model,label:k?slotLabel(k)+(k.startsWith('dps')?' '+k.slice(3):''):nameOf(i)})}}
  else for(const g of groupsOf(s)){const ag=g.filter(isAgent);if(!ag.length)continue;const m0=H[ag[0]].mind;
    if(ag.length>1&&ag.length===g.length&&ag.every(i=>same(H[i].mind,m0)))
      out.push({kind:'company',heroes:ag.slice(),provider:m0.provider,model:m0.model,label:'the company of '+ag.map(nameOf).join(' and ')});
    else for(const i of ag)out.push({kind:'hero',index:i,provider:H[i].mind.provider,model:H[i].mind.model,label:nameOf(i)})}
  const dm=s.dm&&s.dm.mode==='agent'&&s.dm.provider&&s.dm.model?s.dm:DEFAULT_DM();out.push({kind:'dm',provider:dm.provider,model:dm.model,label:'the DM'});
  return out}
