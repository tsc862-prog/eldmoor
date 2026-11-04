// Companies (epic #402, slice 1, issue #438): the unit agent heroes ride in. DOM-free, no RNG. Owned by ai-designer.
// Design: docs/emergent-parties.md (sections 1 and 7, owner decisions of 2026-11-03).
//
// S.companies = [{id, name, fac, hall, ids:[heroId], founded (gameMin), day, log:[entry], past:[{...}], npcs:[name],
//   seq, ...}], in id order. A company holds 1..PARTY.MAX heroes of one faction; at most PARTY.MINDS of them agent minds
//   (the mind cap is enforced by the grouping verbs, #455). Every agent-played hero is in exactly one company: a hero
//   alone is a company of one (a solo). a.company = the company's id; a company's walking group is a S.parties row
//   with p.company set. S.companiesPast keeps the record of companies that ended; S.followId is the company the
//   watcher follows (default: the first).
//
// The Fellowship is a name a company carries: the classic five places are the `slots` option of a company (the slots
// section below, #588). slotted() names the company that has them (null when there is none); read membership with
// inSlots(a), slotKeyOf(a) and partySlotted(p). Saves carry only S.companies / a.company / p.company (the old
// S.fellowship, a.fellow, a.fellowRole and p.fellow accessors are gone; save.js migrates v6 saves that stored them).
import {S,clockStr} from './state.js';
import {swornOf,hushOath} from './oath.js'; // only a sworn oath is an open thread (#800)
import {homeOf} from '../data/races.js';
import {FAC} from '../data/factions.js';
import {bond} from './bonds.js';
import {CITY,ZONES,zoneFor,zoneAt,dist} from '../world/map.js';
import {solidAt,standAt} from '../world/passable.js';
import {ELITES,MOBS} from '../data/mobs.js';
import {hash} from '../core/rng.js';
import {log} from './chronicle.js';
import {record,timeline,onRecord} from './history.js';
import {makeHero,maxHp,goHome,seedLevel} from './heroes.js';
import {leaveParty} from './party.js';
import {moment} from './reflect.js'; // reflection moments (#179)
import {disableBrain,askRelay} from './brain.js';
import {markPlayer} from './player.js';
import {seedProfs} from './professions.js';
import {buildPersona,buildBackstory,personaSnapshot,backstorySnapshot,applyPersona,applyBackstory,keepSelf} from './persona.js';
import {STANCE_MAX} from '../data/prompts.js';
import {remember,memOf,refreshStances,stanceEvent,setSummariser,memorySnapshot,applyLong} from './memory.js';

export const PARTY={MAX:8,MINDS:5,OFFER_MIN:60,LETTER_DAYS:3}; // OFFER_MIN: game minutes an offer to ride together stands (sim/offers.js, #442);
// LETTER_DAYS: a fallen member's letter waits this long for a joiner of their class, then goes to the next joiner (#452)
export const DPS=['Mage','Hunter','Rogue','Skald'];
export const HEALERS=['Priest','Wildspeaker'];
export const LOG_CAP=300;
// Roles are labels, not slots: Warrior = tank, the healing classes = healer, everyone else = dps.
export const roleOf=cls=>cls==='Warrior'?'tank':HEALERS.includes(cls)?'healer':'dps';

const byId=id=>S.agents.find(x=>x.id==id);
const alive=x=>!!x&&x.kind==='hero'&&x.state!=='dead';
const day=()=>Math.floor(S.gameMin/1440)+1;
const list=()=>S.companies||(S.companies=[]);
const plain=ps=>(ps||[]).map(p=>typeof p==='string'?p:p&&p.kind==='hero'?p.name:p&&p.t||'').join('');

// ---- reading ----
export const companyById=id=>id==null?null:(S.companies||[]).find(C=>C.id===id)||null;
export const companies=()=>(S.companies||[]).filter(C=>C.ids.length).sort((x,y)=>x.id-y.id);
export function companyOf(a){if(!a||a.company==null)return null;const C=companyById(a.company);return C&&C.ids.includes(a.id)?C:null}
export const members=C=>C?C.ids.map(byId).filter(alive):[];
export const minds=C=>members(C).filter(a=>a.player);
export function mates(a){const C=companyOf(a);return C?members(C).filter(b=>b!==a):[]}
export const isSolo=C=>!!C&&C.ids.length===1;
// The living agent member with the highest level, ties by total bond with the others, then id. A solo leads itself.
export function leaderOf(C){const L=members(C).filter(a=>a.player);if(!L.length)return null;
  const tb=a=>L.reduce((t,b)=>t+(b===a?0:bond(a,b)),0);
  return L.slice().sort((x,y)=>y.lvl-x.lvl||tb(y)-tb(x)||x.id-y.id)[0]}
// The company the watcher follows; slotted() is the five-slot one (the followed company when it has slots).
export const followed=()=>companyById(S.followId)||companies()[0]||null;
export function fellowshipCompany(){const f=followed();if(f&&f.slots)return f;return (S.companies||[]).find(C=>C.slots)||null}

// The one company that carries the five slots stands in the list; any other slotted company leaves it (null: none).
function setSlotCompany(v){const L=list();for(let i=L.length-1;i>=0;i--)if(L[i].slots&&L[i]!==v)L.splice(i,1);
  if(v&&!L.includes(v)){L.push(v);L.sort((x,y)=>x.id-y.id)}}
// A member or a company party: drop the fields older saves or the old accessors left behind (#588). Kept as the
// one place a hero or party joins a company, so later per-company caches have a hook.
export function linkHero(a){if(a&&typeof a==='object'){delete a.fellow;delete a.fellowRole;delete a.fellowFrom}return a}
export function linkParty(p){if(p&&typeof p==='object')delete p.fellow;return p}

// ---- the campaign log (any company) ----
var witnessFn; // no initializer: reach.js may set it while this module is still loading (an import cycle)
export function setWitness(f){witnessFn=f}
export function campaign(C,kind,...parts){if(!C)return null;
  const e={id:C.seq=(C.seq||0)+1,day:day(),t:clockStr(),gameMin:Math.round(S.gameMin),kind,parts};
  C.log.unshift(e);if(C.log.length>LOG_CAP)C.log.pop();if(witnessFn&&C.ids.length>1)witnessFn(kind,plain(parts).slice(0,80),C);return e} // reach.js: what a member out of range missed (#182), per company (#439)
const gd=t=>({t,c:'gd'});
// Open threads: unfinished jobs, meeting plans, living nemeses, oaths still sworn. Computed live, not stored.
export function openThreads(C){if(!C)return [];const out=[],seen=new Set();
  for(const v of S.adventures||[])if(v.phase==='active'&&v.mem&&v.mem.some(id=>C.ids.includes(id)))out.push({kind:'job',parts:['Unfinished job: ',gd(v.title),' (scene '+((v.idx||0)+1)+' of '+((v.scenes||[]).length||'?')+')']});
  for(const p of C.plans||[])if(p.status==='open')out.push({kind:'meeting',parts:['Meeting: ',gd(p.where),' at '+p.atText+' ('+p.whoNames.join(', ')+' know)']}); // #182
  for(const a of members(C)){for(const id in a.nemesis||{}){const n=byId(id);if(alive(n)&&!seen.has(n.id)){seen.add(n.id);out.push({kind:'nemesis',parts:['Blood owed: ',n,' of the '+FAC[n.fac].name+' (',a,' swore it for '+a.nemesis[id]+')']})}}
    if(a.vow)out.push({kind:'oath',parts:[a,' swore, aloud: ',gd(a.vow.text)]}); // a sworn vow (#526): the DM can stage its keeping
    const bk=a.vowBroke&&S.gameMin-a.vowBroke.at<3*1440?a.vowBroke:null;if(bk)out.push({kind:'broken',parts:[a,bk.how==='failed'?' failed a vow: ':' broke their word: ',gd(bk.text)]});
    const g=swornOf(a);if(g)out.push({kind:'oath',parts:g.sworn&&g.sworn.words?[a,' swore: ',gd(g.text)]:[a,' swore to ',gd(g.text.charAt(0).toLowerCase()+g.text.slice(1)),' ('+(g.progress||0)+'/'+g.need+')']})}
  return out}

// ---- writing (data only: no lines, no chronicle; the callers write the story) ----
const seqNext=()=>S.companySeq=(S.companySeq||0)+1;
export function newCompany(o){const lead=o.lead;return {id:o.id!=null?o.id:seqNext(),name:o.name||'',fac:o.fac,hall:o.hall||(lead?homeOf(lead).name:''),ids:[],
  founded:Math.round(S.gameMin),day:day(),log:[],past:[],npcs:[],seq:0}}
// Why a hero may not ride with C, or null.
export function refuseJoin(C,a){if(!C)return 'No such company.';if(!alive(a))return 'That hero is not alive.';
  if(C.ids.includes(a.id))return a.name+' already rides with it.';if(a.fac!==C.fac)return a.name+' is of the other faction; a company is of one faction.';
  if(C.ids.length>=PARTY.MAX)return 'A company holds at most '+PARTY.MAX+' heroes.';return null}
// Point a hero at C without touching C.ids (the five-slot Fellowship keeps its ids in slot order itself).
export function attach(C,a){const old=companyOf(a);if(old&&old!==C)leaveCompany(a);a.company=C.id;linkHero(a);return a}
export function foundCompany(ids,o={}){const hs=(ids||[]).map(x=>typeof x==='object'?x:byId(x)).filter(Boolean);
  if(!hs.length&&o.fac==null)return {ok:false,error:'A company needs at least one hero.'};
  const fac=o.fac!=null?o.fac:hs[0].fac;if(hs.some(a=>a.fac!==fac))return {ok:false,error:'A company is of one faction.'};
  if(hs.length>PARTY.MAX)return {ok:false,error:'A company holds at most '+PARTY.MAX+' heroes.'};
  if(hs.some(a=>!alive(a)))return {ok:false,error:'Only living heroes ride in a company.'};
  let lead=hs[0];for(const b of hs)if(b.lvl>lead.lvl)lead=b;
  const C=newCompany({id:o.id,name:o.name!=null?o.name:hs.length===1?hs[0].name:'',fac,hall:o.hall,lead});
  const L=list();L.push(C);L.sort((x,y)=>x.id-y.id);
  for(const a of hs){attach(C,a);C.ids.push(a.id)}
  return {ok:true,company:C}}
export function joinCompany(C,a){const bad=refuseJoin(C,a);if(bad)return {ok:false,error:bad};attach(C,a);C.ids.push(a.id);(C.joined||(C.joined={}))[a.id]=Math.round(S.gameMin);return {ok:true,company:C}} // joined: for the letters (#452)
// A hero leaves its company (it never ends with zero heroes: an emptied company is dissolved). Returns the old company.
export function leaveCompany(a,o={}){const C=companyOf(a);if(a&&a.company!=null)delete a.company;if(!C)return null;
  C.ids=C.ids.filter(id=>id!==a.id);if(C.slots)for(const k in C.slots)if(C.slots[k]===a.id)C.slots[k]=null;
  if(!C.ids.length&&!o.keep)dissolveCompany(C);return C}
// B rides on as part of A (data only). Refused across factions or past the hero cap.
export function mergeCompanies(A,B){if(!A||!B||A===B)return {ok:false,error:'Two companies are needed.'};
  if(A.fac!==B.fac)return {ok:false,error:'A company is of one faction.'};
  if(A.ids.length+B.ids.length>PARTY.MAX)return {ok:false,error:'Together they would be '+(A.ids.length+B.ids.length)+'; a company holds at most '+PARTY.MAX+'.'};
  for(const id of B.ids.slice()){const a=byId(id);if(a){a.company=A.id;linkHero(a)}if(!A.ids.includes(id))A.ids.push(id)}
  A.past=A.past.concat(B.past||[]);for(const n of B.npcs||[])if(!A.npcs.includes(n))A.npcs.push(n);
  B.ids=[];dissolveCompany(B,'merged');if(S.followId===B.id)S.followId=A.id;return {ok:true,company:A}}
export function dissolveCompany(C,why){const L=list(),i=L.indexOf(C);if(i<0)return;L.splice(i,1);
  for(const id of C.ids){const a=byId(id);if(a&&a.company===C.id)delete a.company}
  for(const p of S.parties||[])if(p.company===C.id)delete p.company;
  if(C.log.length||C.ids.length>1||C.past.length)S.companiesPast=(S.companiesPast||[]).concat([{id:C.id,name:C.name,fac:C.fac,founded:C.founded,ended:Math.round(S.gameMin),fallen:C.past.length,...(why?{why}:{})}]).slice(-10);
  if(S.followId===C.id)S.followId=null}

// ---- upkeep ----
// Every agent-played hero in exactly one company: a solo for one who has none. A slotted company's deaths go
// through the slots section below (onDeath and the replacement); other companies just drop their dead and end when empty.
export function soloFor(a){if(!alive(a)||!a.player||companyOf(a))return companyOf(a);const r=foundCompany([a]);return r.ok?r.company:null}
// A death in a company other than the five-slot Fellowship goes to the death hook (sim/arrival.js, #452): in a world with
// runners the seat is refilled through an arrival scene, and a solo's heir starts at home; with no host nothing changes.
let deathHook=null;
export function setCompanyDeathHook(f){deathHook=typeof f==='function'?f:null}
export function companyTick(){const L=S.companies;if(!L||!L.length)return;
  for(const C of L.slice()){if(C.slots)continue;let gone=false;
    for(const id of C.ids){const a=byId(id);if(!alive(a)){gone=true;if(a){if(a.company===C.id)delete a.company;C.past.push({id:a.id,name:a.name,cls:a.cls,lvl:a.lvl,cause:a.cause||'lost',day:day()});
      if(C.letters)for(const k in C.letters){const l=C.letters[k];if(l&&l.from===a.id&&l.fell==null)l.fell=Math.round(S.gameMin)}
      if(deathHook)deathHook(C,a)}}}
    if(gone){C.ids=C.ids.filter(id=>alive(byId(id)));if(!C.ids.length)dissolveCompany(C)}}}
// After a load: the accessors on members and company parties, and the one-company rule for agent heroes.
export function relinkCompanies(){if(!Array.isArray(S.companies))S.companies=[];
  for(const a of S.agents||[])if(a&&a.company!=null)linkHero(a);
  for(const p of S.parties||[])if(p&&p.company!=null)linkParty(p);
  for(const a of S.agents||[])if(alive(a)&&a.player&&!companyOf(a))soloFor(a)}

// ==== the slots option (#588): the classic five places (moved here from fellowship.js) ====
// A company may carry C.slots = {tank, healer, dps1, dps2, dps3: heroId|null}: one Tank (Warrior), one Healer and three
// DPS (one of each class preferred, repeats allowed). Such a company also keeps seed (its name's hash seed), from
// ({heroId: home town before joining}: members lodge in its hall so they muster at one gate), last ({slot: last seen
// member}), dmSeen, ai (relay sheet writing), minds ('agent'), enrich ({calls,ok,fail,usd,ms}) and hold. Its C.ids stay
// in slot order. At most one company carries slots: slotted().
// How it runs (slotsTick, once per step; a no-op without one):
//   muster   the members form one party (p.company) in town; party.js keeps the usual follow / shared XP / heal
//            behaviour, never dissolves it on a level gap and never lets a member join another party
//   hold     a member at the gate waits (up to HOLD_MAX real seconds) for companions still selling, questing or
//            walking home, so the party leaves together
//   watch    level-ups, elite kills, bonds, loot and blood debts (the record hook), notable fights and flights, town
//            visits and every DM beat of their adventures become memories and campaign log lines
//   death    hardcore: the dead stay dead; survivors head home and the DM offers the empty place to the most-bonded
//            living hero of that class, else the next recruit of that class (or an arrival scene, sim/arrival.js)
export const SLOTS=[{key:'tank',role:'tank',label:'Tank',cls:['Warrior']},{key:'healer',role:'healer',label:'Healer',cls:HEALERS},
  {key:'dps1',role:'dps',label:'DPS',cls:DPS},{key:'dps2',role:'dps',label:'DPS',cls:DPS},{key:'dps3',role:'dps',label:'DPS',cls:DPS}];
export const SLOT_KEYS=SLOTS.map(s=>s.key);
export const HOLD_MAX=20,TIMEOUT={backstory:65000,persona:45000,memory:16000};
const slotOf=k=>SLOTS.find(s=>s.key===k);
const lcRole=k=>{const l=slotOf(k).label;return l==='DPS'?l:l.toLowerCase()};
export const fits=(k,a)=>!!(a&&slotOf(k)&&slotOf(k).cls.includes(a.cls));
const loose=b=>b.state==='hunt'||b.state==='travel'||b.state==='follow'||b.state==='return';
const slotIds=C=>SLOT_KEYS.map(k=>C.slots[k]).filter(id=>id!=null);

// ---- reading ----
export const slotted=()=>fellowshipCompany(); // the company with the five places, or null
// A hero in a slotted company / a party walking for one.
export function inSlots(a){const C=companyOf(a);return !!(C&&C.slots)&&!a.hire} // a hire rides with the Fellowship but holds no place in it (#634)
export function partySlotted(p){if(!p)return false;const C=companyById(p.company);return !!(C&&C.slots)}
// The hero's slot key (tank, healer, dps1-3), or undefined.
export function slotKeyOf(a){const C=companyOf(a);if(!C||!C.slots)return undefined;for(const k in C.slots)if(C.slots[k]===a.id)return k;return undefined}
// Places in slot order: [{slot, role, label, hero|null}] (hero null while a place stands empty).
export function slotMembers(C){if(!C||!C.slots)return [];
  return SLOTS.map(s=>({slot:s.key,role:s.role,label:s.label,hero:C.slots[s.key]!=null?byId(C.slots[s.key])||null:null}))}
export const slotHeroes=C=>slotMembers(C).map(m=>m.hero).filter(alive);
export const slotParty=C=>C?(S.parties||[]).find(p=>p.company!=null&&p.company===C.id)||null:null;
export const slotLabel=a=>{const k=a&&slotKeyOf(a),s=k&&slotOf(k);return s?s.label:null};
export const wasSlotted=(a,C=slotted())=>!!(a&&C&&(inSlots(a)||C.past.some(p=>p.id===a.id)));
export const lcRoleOf=k=>slotOf(k)?lcRole(k):'companion';
// The same beat for several members at once (a shared kill, a party level-up) is one line: 'A, B and C slew ...'.
export function campaignBy(C,kind,a,...tail){if(!C)return null;const e=C.log[0],tt=plain(tail);
  if(e&&e.kind===kind&&e.tail===tt&&Math.abs(e.gameMin-S.gameMin)<=3&&Array.isArray(e.who)&&!e.who.includes(a.id)){e.who.push(a.id);
    const hs=e.who.map(byId).filter(Boolean),ps=[];hs.forEach((h,i)=>{ps.push(h);if(i<hs.length-2)ps.push(', ');else if(i===hs.length-2)ps.push(' and ')});e.parts=[...ps,...tail];return e}
  const n=campaign(C,kind,a,...tail);n.who=[a.id];n.tail=tt;return n}

// ---- names in faction voice (a lore-keeper pass reviews the word lists) ----
const NAME_PARTS=[
  {forms:['The {adj} {noun}','The {noun} of {hall}','The {adj} {noun} of {home}','The {noun} of the {adj} Road'],
   adj:['Dun','Quiet','Hedge','Ninth','Iron','Last','Patient','Saltwater','Lamplit','Long'], // no Grey (+Company = Tolkien) and no words shared with the noun list
   noun:['Company','Covenant','Fellowship','Lantern','Watch','Oath','Ledger','Wardens']},
  {forms:['The {adj} {noun}','{lead}’s {adj} Five','The {noun} of {hall}','The {adj} {noun}'],
   adj:['Broken','Red','Ash','Gnashing','Black','Bone','Mud','Scarred','Howling','Last'],
   noun:['Teeth','Fist','Five','Pack','Knot','Tusks','Banner','Pit']}];
export function companyName(fac,lead,seed,hallName){const P=NAME_PARTS[fac===1?1:0],h=(i,l)=>l[Math.floor(hash(seed|0,i,31)*l.length)%l.length];
  const hall=hallName||homeOf(lead).name,home=lead.home||hall;
  return h(1,P.forms).replace('{adj}',h(2,P.adj)).replace('{noun}',h(3,P.noun)).replace('{hall}',hall).replace('{home}',home).replace('{lead}',lead.name)}

// ---- choosing the five ----
const eligible=(a,fac)=>alive(a)&&a.fac===fac&&!inSlots(a)&&!a.player;
// "Form one for me": for each tank, greedily add the healer and three DPS with the best bonds to those already chosen and
// the closest levels (distinct DPS classes preferred); keep the best team. An empty place (no hero of that class alive)
// is left null and filled with a recruit at founding.
export function autoPick(fac){const pool=S.agents.filter(a=>eligible(a,fac));
  const of=cls=>pool.filter(a=>cls.includes(a.cls));
  const tanks=of(['Warrior']).sort((x,y)=>y.lvl-x.lvl||x.id-y.id).slice(0,8);
  const score=(c,team)=>{let s=0;for(const b of team)s+=bond(c,b)*2-Math.abs(c.lvl-b.lvl)*1.5;return s};
  let best=null,bs=-1e9;
  for(const T of tanks.length?tanks:[null]){const team=T?[T]:[],slots={tank:T?T.id:null};
    const add=(k,cands)=>{const c=cands.filter(x=>!team.includes(x)).sort((x,y)=>score(y,team)-score(x,team)||y.lvl-x.lvl||x.id-y.id)[0];slots[k]=c?c.id:null;if(c)team.push(c)};
    add('healer',of(HEALERS));
    for(const k of ['dps1','dps2','dps3']){const used=team.filter(b=>DPS.includes(b.cls)).map(b=>b.cls);
      const fresh=of(DPS).filter(x=>!used.includes(x.cls)&&!team.includes(x));add(k,fresh.length?fresh:of(DPS))}
    let s=team.length*100;for(const x of team)for(const y of team)if(x.id<y.id)s+=bond(x,y)*2-Math.abs(x.lvl-y.lvl)*1.5;
    if(s>bs){bs=s;best=slots}}
  return best||{tank:null,healer:null,dps1:null,dps2:null,dps3:null}}

// Check a proposed slot map: five distinct living heroes (or null = recruit), one faction, classes fit.
export function checkSlots(slots,fac){const seen=new Set(),F=slotted();
  for(const s of SLOTS){const id=slots[s.key];if(id==null)continue;const a=byId(id);
    if(!alive(a))return s.label+': that hero is not alive.';if(a.fac!==fac)return a.name+' is not of the '+FAC[fac].name+'.';
    if(!fits(s.key,a))return a.name+' is a '+a.cls+'; the '+s.label+' slot needs '+s.cls.join(' or ')+'.';
    if(inSlots(a)&&!(F&&F.ids.includes(a.id)))return a.name+' already rides with a Fellowship.';
    if(seen.has(a.id))return a.name+' is in two slots.';seen.add(a.id)}
  return null}

// The next recruit of a class: a pending recruit of that faction and class arrives now, else a fresh one.
// It arrives a few levels under the company's lowest living member (balance #107), not at level 1 beside veterans.
export const SEED_BEHIND=2;
function recruit(C,fac,cls){const i=S.recruits.findIndex(r=>r.fac===fac&&r.cls===cls);if(i>=0)S.recruits.splice(i,1);
  const mates=slotHeroes(C),a=hushOath(()=>makeHero(fac,cls,null,1));if(mates.length)seedLevel(a,Math.min(...mates.map(b=>b.lvl))-SEED_BEHIND);log('A new ',cls.toLowerCase(),', ',a,', is sent for to fill a place in the Fellowship.');return a}

// ---- founding, joining, leaving ----
// Where the i-th of n stands around a point: two rows, a tile and a half apart, in order. No dice.
export function spreadAt(p,i,n){const cols=Math.ceil(n/2),q={x:p.x+(i%cols-(cols-1)/2)*1.5,y:p.y+(i<cols?-.7:.7)};return solidAt(q.x,q.y)?standAt(q.x,q.y,2):q} // not on a building (#793)
// A new world's company stands in its hall (#771): a setup's members come from their peoples' home towns, and an opening
// scene takes only those in shouting range. Members already all inside the hall town stay exactly where they are (a
// single-people company builds the world of before), so this rolls no dice. Returns those who came from another town;
// a.born keeps that town for their origin text (a.town, the home they return to, is the hall).
function gatherAtHall(F,mem){const c=CITY.find(t=>t.name===F.hall);if(!c||mem.every(a=>a.x>=c.x0&&a.x<=c.x1+1&&a.y>=c.y0&&a.y<=c.y1+1))return [];
  const p=c.spots.hall||c.spots.square||{x:(c.x0+c.x1+1)/2,y:(c.y0+c.y1+1)/2},came=[];
  mem.forEach((a,i)=>{Object.assign(a,spreadAt(p,i,mem.length),{state:'town',townStep:1,dest:null,moving:false});
    const was=F.from&&F.from[a.id];if(was&&was!==F.hall){a.born=was;came.push(a)}});
  return came}
export function foundSlots(slots,o={}){if(slotted())return {ok:false,error:'A Fellowship already rides. Disband it first.'};
  const ids=SLOT_KEYS.map(k=>slots[k]).filter(id=>id!=null),first=ids.map(byId).find(alive);
  const fac=o.fac!=null?o.fac:first?first.fac:null;if(fac==null)return {ok:false,error:'Pick at least one hero, or a faction.'};
  const bad=checkSlots(slots,fac);if(bad)return {ok:false,error:bad};
  const filled={};for(const s of SLOTS){const id=slots[s.key];filled[s.key]=id!=null?byId(id):recruit(slotted(),fac,s.cls.find(c=>!SLOTS.some(t=>t.key!==s.key&&filled[t.key]&&filled[t.key].cls===c))||s.cls[0])}
  const mem=SLOT_KEYS.map(k=>filled[k]);let lead=mem[0];for(const b of mem)if(b.lvl>lead.lvl)lead=b;
  const seed=++S.uid; // the name's hash seed (it was the Fellowship's id before companies, #438; uid use unchanged)
  const F=Object.assign(newCompany({fac,lead,hall:o.hall}),{seed,slots:{},from:{},dmSeen:S.dmLogSeq||0,ai:o.ai!==false,minds:'agent',enrich:{calls:0,ok:0,fail:0,usd:0,ms:0}});
  setSlotCompany(F);if(S.followId==null)S.followId=F.id;
  F.name=(o.name&&String(o.name).trim().slice(0,40))||companyName(fac,lead,seed,F.hall);
  for(const s of SLOTS)joinSlot(F,filled[s.key],s.key,null,true);
  const came=o.gather?gatherAtHall(F,mem):[]; // a new world only: a founding in a running world never moves anyone
  const roster=[];mem.forEach((b,i)=>{roster.push(b,' ('+slotOf(SLOT_KEYS[i]).label+')');if(i<mem.length-2)roster.push(', ');else if(i===mem.length-2)roster.push(' and ')});
  campaign(F,'found',gd(F.name),' is founded in '+F.hall+': ',...roster,'.');
  if(came.length){campaign(F,'found',...came.flatMap((b,i)=>[...(i?[', ']:[]),b,', come from '+b.born]),'.');for(const b of came)record(b,'Came to '+F.hall+' from '+b.born+' to swear in.')}
  log('In ',F.hall,', ',...roster,' swear themselves into ',gd(F.name),'. Whatever comes, it comes to the five of them.');
  timeline('oath',gd(F.name),' is founded in '+F.hall+' by ',lead,' and four companions.');
  for(const b of mem){record(b,'Swore into ',gd(F.name),' as its '+slotLabel(b)+'.');remember(b,'join','Swore into '+F.name+' in '+F.hall+' as its '+slotLabel(b)+', beside '+mem.filter(x=>x!==b).map(x=>x.name).join(', ')+'.')}
  for(const b of mem)if(!b.persona||!b.backstory)sheets(F,b);
  for(const b of mem)refreshStances(b,F.ids);
  muster(F);if(F.ai)for(const b of mem)enrich(F,b);
  return {ok:true,fellowship:F,company:F}}

// Put a hero in a place. quiet: the founding writes its own lines.
export function joinSlot(F,a,key,why,quiet){if(!F||!F.slots||!alive(a)||!fits(key,a))return false;
  const old=F.slots[key]!=null?byId(F.slots[key]):null;if(old&&old!==a)leaveSlot(F,old,'replaced');
  if(a.party&&!partySlotted(a.party))leaveParty(a);
  const from=F.from||(F.from={});if(from[a.id]==null)from[a.id]=a.town||null;attach(F,a); // a solo's own company ends as it joins
  if(why==='arrival'&&a.town&&a.town!==F.hall)a.born=a.town; // their people's town stays in their origin text (#771)
  F.slots[key]=a.id;F.ids=slotIds(F);a.town=F.hall;
  if(!quiet||why==='arrival')(F.joined||(F.joined={}))[a.id]=Math.round(S.gameMin); // when they joined: a fallen member's letter goes to a later joiner (#452)
  memOf(a);agentMind(a); // the Fellowship is always agent-played (#148): one mind per member, its agent (#126)
  if(!quiet){campaign(F,'recruit',a,' joins ',gd(F.name),' as its '+slotOf(key).label+(why?' ('+why+')':'')+'.');
    log(a,' takes the empty place in ',gd(F.name),' as its '+lcRole(key)+'.');
    timeline('oath',a,' joins ',gd(F.name),' as its '+slotOf(key).label+'.');
    record(a,'Joined ',gd(F.name),' as its '+slotOf(key).label+'.');
    sheets(F,a);remember(a,'join','Joined '+F.name+' as its '+slotOf(key).label+(why?', '+why:'')+'. '+slotHeroes(F).filter(b=>b!==a).map(b=>b.name).join(', ')+' ride with me now.');
    for(const b of slotHeroes(F))if(b!==a){remember(b,'join',a.name+' took the empty place as our '+slotOf(key).label+'.');refreshStances(b,F.ids)}
    refreshStances(a,F.ids);if(F.ai)enrich(F,a);muster(F)}
  return true}

// A hero leaves (removed by the user, replaced, or the company disbands). Dead members go through onDeath.
export function leaveSlot(F,a,why){if(!F||!F.slots||!a)return;const k=SLOT_KEYS.find(k=>F.slots[k]===a.id);if(k)F.slots[k]=null;
  F.ids=slotIds(F);
  if(a.party&&partySlotted(a.party))leaveParty(a);
  if(a.company===F.id)leaveCompany(a,{keep:true});
  if(a.fellowBrain){disableBrain(a);delete a.fellowBrain}if(a.fellowAgent){if(a.state!=='dead')markPlayer(a,false);delete a.fellowAgent}delete a.splitUntil;
  const from=F.from&&F.from[a.id];if(from!=null&&a.state!=='dead'){a.town=from}if(F.from)delete F.from[a.id];
  if(a.player)soloFor(a); // still agent-played: rides on as a company of one
  if(alive(a)&&why!=='disband'){campaign(F,'leave',a,' leaves ',gd(F.name),why?' ('+why+')':'','.');record(a,'Left ',gd(F.name),'.')}}

// Who plays the members (hard rule, #148): always their agents. There is no scripted or single-call AI mode for a
// member; the only choice left is which model each member's runner plays with (the runner settings, ui/runners.js).
// Every member is agent-played (markPlayer) from founding, joining or replacement on; one who leaves is handed back
// to the scripted rules (background heroes may be scripted). Between decisions a member auto-plays (sim/player.js
// autopilot and reflexes); its decisions wait for its runner (sim/runlink.js). 'off' and 'relay' are gone: an older
// save that still has them is converted.
export const MINDS=['agent'];
export const mindsOf=F=>F?'agent':'off';
// A member's one mind: its agent. No relay brain (the relay still writes sheets when F.ai).
function agentMind(a){let n=0;if(a.brain||a.fellowBrain){disableBrain(a);delete a.fellowBrain;n++}
  if(!a.player){if(markPlayer(a,true)){a.fellowAgent=true;n++}}return n}
export function setSlotMinds(F,mode){if(!F||!F.slots||!MINDS.includes(mode))return false;F.minds='agent';for(const a of slotHeroes(F))agentMind(a);return true}
// Every member agent-played (called each tick: a restored older save, or anything that unmarked one).
// An older save's scripted or AI members are converted with a notice (#148).
export function enforceAgents(F){if(!F)return 0;let n=0;for(const a of slotHeroes(F))n+=agentMind(a)?1:0;
  if(F.minds!=='agent'){const was=F.minds||(F.ai?'relay':'off');F.minds='agent';
    if(n){campaign(F,'note','The Fellowship is always agent-played now: '+n+' member'+(n===1?'':'s')+' who '+(n===1?'was':'were')+' '+(was==='relay'?'played by the relay or the scripted rules':'scripted')+' '+(n===1?'is':'are')+' agent-played (start their runners; reflexes keep them alive meanwhile).');
      log(gd(F.name),' is agent-played from now on: every member answers to their own agent.')}}
  return n}

export function disbandSlots(F){if(!F||!F.slots)return;
  for(const a of slotHeroes(F))leaveSlot(F,a,'disband');const p=slotParty(F);if(p){delete p.company}
  log(gd(F.name),' is disbanded. The road takes them back one at a time.');
  S.companiesPast=(S.companiesPast||[]).concat([{id:F.id,name:F.name,fac:F.fac,founded:F.founded,ended:Math.round(S.gameMin),fallen:F.past.length}]).slice(-10);
  for(const id of F.ids){const a=byId(id);if(a&&a.company===F.id)delete a.company}
  setSlotCompany(null);if(S.followId===F.id)S.followId=null}

// Hardcore replacement: the most-bonded living hero who fits the place, else the next recruit of the class.
export function offerReplacement(F,key){if(!F||!F.slots||F.slots[key]!=null)return null;const s=slotOf(key),mates=slotHeroes(F);
  const used=mates.filter(b=>DPS.includes(b.cls)).map(b=>b.cls);
  const avg=mates.length?mates.reduce((t,b)=>t+b.lvl,0)/mates.length:1;
  const cands=S.agents.filter(a=>eligible(a,F.fac)&&s.cls.includes(a.cls)).map(a=>({a,b:mates.reduce((t,m)=>t+bond(a,m),0),d:Math.abs(a.lvl-avg),fresh:s.role!=='dps'||!used.includes(a.cls)}))
    .sort((x,y)=>y.b-x.b||(y.fresh-x.fresh)||x.d-y.d||x.a.id-y.a.id);
  const c=cands[0];
  if(c&&(c.b>0||c.d<=3)){joinSlot(F,c.a,key,c.b>0?'the DM offered the place to the hero who knew them best':'the DM offered the place to a hero of their level');placeProfs(c.a,key);return c.a}
  const cls=s.role==='dps'?(DPS.find(x=>!used.includes(x))||DPS[0]):s.cls[0];
  const a=recruit(F,F.fac,cls);joinSlot(F,a,key,'a fresh recruit, sent for by the DM');placeProfs(a,key);return a}
// The professions the owner chose for this place at setup (S.setup.profs, #259) pass to whoever fills it.
function placeProfs(a,key){const p=S.setup&&S.setup.profs;if(p&&p[key])seedProfs(a,p[key])}

// The record of a member whose grave was recycled before the tick saw them fall: last seen name, class and level.
function ghost(F,key){const l=(F.last||{})[key]||{},f=S.fallen.find(x=>x.name===l.name);
  return {id:l.id==null?null:l.id,name:l.name||'A companion',cls:l.cls||'?',lvl:(f&&f.lvl)||l.lvl||0,cause:(f&&f.cause)||'lost'}}
function onDeath(F,a,key){F.slots[key]=null;F.ids=slotIds(F);
  const lvl=a?a.lvl:0,cause=a&&a.cause||'lost';
  F.past.push({id:a?a.id:null,name:a?a.name:'?',cls:a?a.cls:'?',slot:key,lvl,cause,day:day()});
  if(a){if(a.company===F.id)delete a.company;a.fellowPast=F.id}
  const who=a&&a.kind==='hero'?a:gd(a&&a.name||'a companion');
  campaign(F,'death',who,' fell at level '+lvl+' ('+cause+'). The '+lcRole(key)+'’s place stands empty.');
  log({t:'',c:'nar'},gd(F.name),' has lost ',who,', their '+lcRole(key)+', '+cause+'. Hardcore: there is no coming back.');
  for(const b of slotHeroes(F))moment(b,'death',(a&&a.name||'a companion')+' fell ('+cause+')'); // reflection moment (#179)
  for(const b of slotHeroes(F)){remember(b,'death',(a&&a.name||'A companion')+', our '+lcRole(key)+', fell ('+cause+'). One life each, and that was theirs.');
    if(b.state==='hunt'||b.state==='travel'||b.state==='follow')goHome(b)} // the survivors carry the news home
  if(F.letters)for(const k in F.letters){const l=F.letters[k];if(l&&a&&l.from===a.id&&l.fell==null)l.fell=Math.round(S.gameMin)} // the letter waits for the next joiner (#452)
  // A world with runners (a host reports their links): the place is refilled through an arrival scene at the next camp
  // or town (sim/arrival.js, #452). No host (npm run sim, the checks): the replacement takes the place at once, as always.
  if(arrivalHook&&arrivalHook(F,{slot:key,cls:a&&a.cls&&a.cls!=='?'?a.cls:null,fallen:a?a.id:null,name:a&&a.name||'a companion',lvl}))return;
  offerReplacement(F,key)}
let arrivalHook=null;
export function setArrivalHook(f){arrivalHook=typeof f==='function'?f:null}
// The arrival scene opens (sim/arrival.js): the recruit of the fallen member's class, seeded SEED_BEHIND under the lowest
// living member, takes the empty place. The oath, its lines and the memories come from the scene's outcome.
export function seatRecruit(F,q){if(!F||!F.slots||F.slots[q.slot]!=null)return null;const s=slotOf(q.slot);if(!s)return null;
  const cls=q.cls&&s.cls.includes(q.cls)?q.cls:s.cls[0];const a=recruit(F,F.fac,cls);
  if(!joinSlot(F,a,q.slot,'arrival',true))return null;placeProfs(a,q.slot);sheets(F,a);
  for(const b of slotHeroes(F))refreshStances(b,F.ids);if(F.ai)enrich(F,a);muster(F);
  if(q.fallen!=null)a.succeeds=q.fallen;return a}

// ---- relay enrichment: backstory, then persona, once per member; never awaited ----
const pending=new Set();
export const enriching=a=>!!a&&pending.has(a.id);
function sheets(F,a){const mates=slotHeroes(F);
  if(!a.backstory||!a.backstory.edited)a.backstory=buildBackstory(a,mates,F?F.name:'the Fellowship');
  if(!a.persona||!a.persona.edited)a.persona=keepSelf(a.persona,buildPersona(a,mates))} // what the hero made of itself (become, #409) and the owner's pins stay
function cost(j,F){if(!F||!j)return;F.enrich.calls++;if(j.usage)F.enrich.usd=Math.round((F.enrich.usd+(+j.usage.cost||0))*1e6)/1e6;if(j.ms)F.enrich.ms=j.ms}
const written=x=>!!x&&(x.src==='model'||x.edited||x.selfN>0); // a sheet the model (or the user) already wrote is never asked for again (#117)
export function enrich(F,a){if(!F||!F.ai||pending.has(a.id))return false;
  const needB=!written(a.backstory),needP=!written(a.persona);if(!needB&&!needP)return false;pending.add(a.id);
  const fid=F.id,cur=()=>{const G=slotted();return G&&G.id===fid?G:null},still=()=>!!cur()&&inSlots(a)&&a.state!=='dead';
  const none=Promise.resolve(needB?null:{skip:true});
  (needB?askRelay('backstory',backstorySnapshot(a,slotHeroes(F),F.name),TIMEOUT.backstory,a):none).then(j=>{
    if(!still())return;const G=cur();if(needB){cost(j,G);
      if(j&&!(a.backstory&&a.backstory.edited)&&applyBackstory(a,j,slotHeroes(G),j.model))G.enrich.ok++;else G.enrich.fail++}
    if(!needP)return;
    return askRelay('persona',personaSnapshot(a,slotHeroes(G),G.name),TIMEOUT.persona,a).then(p=>{if(!still())return;const H=cur();cost(p,H);
      if(p&&!(a.persona&&a.persona.edited)&&applyPersona(a,p,slotHeroes(H),p.model)){H.enrich.ok++;refreshStances(a,H.ids)}else H.enrich.fail++})})
    .catch(()=>{}).finally(()=>pending.delete(a.id));return true}
setSummariser((a,items,before,stamp)=>{const F=slotted();if(!F||!F.ai||!inSlots(a))return;
  askRelay('memory',memorySnapshot(a,items,before),TIMEOUT.memory,a).then(j=>{const G=slotted();if(j&&G){cost(j,G);applyLong(a,j.long,stamp)}}).catch(()=>{})});

// User edits from the Fellowship panel: plain strings, cut to the same caps the model gets.
export function editSheet(a,which,field,text,F=slotted()){if(!a)return false;const v=String(text==null?'':text).replace(/\r/g,'').slice(0,600);
  if(which==='persona'){a.persona=a.persona||buildPersona(a,slotHeroes(F));a.persona[field]=field==='traits'?v.split(/[,;\n]/).map(t=>t.trim().slice(0,40)).filter(Boolean).slice(0,6):v;a.persona.edited=true;return true} // traits: a list (#409)
  if(which==='stance'){const b=byId(field);if(!b||b===a)return false;const P=a.persona=a.persona||buildPersona(a,slotHeroes(F)),t=v.trim().slice(0,STANCE_MAX);
    const st=P.stances={...(P.stances||{})},by=P.stanceBy={...(P.stanceBy||{})}; // the owner's line toward one companion (#305); empty hands it back to the bond reading
    if(t){st[b.id]=t;by[b.id]='owner'}else{delete st[b.id];delete by[b.id]}P.edited=true;refreshStances(a,F?F.ids:[]);return true}
  if(which==='backstory'){a.backstory=a.backstory||buildBackstory(a,slotHeroes(F),F?F.name:'the Fellowship');
    if(field==='summary')a.backstory.summary=v;else (a.backstory.paras||(a.backstory.paras={}))[field]=v;a.backstory.edited=true;return true}
  return false}

// ---- the tick ----
function muster(F){const L=slotHeroes(F);let P=slotParty(F);
  for(const b of L)if(b.party&&b.party!==P)leaveParty(b);
  if(!P){const inTown=L.filter(b=>b.state==='town'&&!b.splitUntil);if(inTown.length<2)return;
    let lead=inTown[0];for(const b of inTown)if(b.lvl>lead.lvl)lead=b;
    P=linkParty({id:++S.uid,fac:F.fac,leader:lead,mem:inTown.slice(),zone:zoneFor(Math.min(...inTown.map(b=>b.lvl)),homeOf(lead).gate),home:false,company:F.id});
    for(const b of inTown)b.party=P;S.parties.push(P);return}
  if(P.home)return;
  for(const b of L)if(!b.party&&!b.splitUntil&&(b.state==='town'||(loose(b)&&b.state!=='return'&&dist(b,P.leader)<12))){P.mem.push(b);b.party=P}}

const fightSeen=new Map(),lastState=new Map();
function watch(F,a){const st=a.state,prev=lastState.get(a.id);lastState.set(a.id,st);
  if(st==='fight'&&a.target&&a.target.kind==='mob'){const m=a.target;fightSeen.set(a.id,{m,lvl:m.lvl,elite:!!m.elite,name:m.elite?m.name:MOBS[m.type].name,z:zoneAt(a.x,a.y)});}
  else if(fightSeen.has(a.id)){const f=fightSeen.get(a.id);fightSeen.delete(a.id);
    if(!f.m.alive&&!f.elite&&f.lvl>=a.lvl+2){remember(a,'fight','Brought down a level '+f.lvl+' '+f.name+' in '+ZONES[f.z]+', two levels above me or more.');
      if(f.lvl>=a.lvl+3)campaignBy(F,'fight',a,' brought down a level '+f.lvl+' '+f.name+' in '+ZONES[f.z]+'.')}
    else if(st==='return'&&f.m.alive&&a.hp<maxHp(a)*.35){remember(a,'flee','Broke off from a level '+f.lvl+' '+f.name+' in '+ZONES[f.z]+', bleeding, and ran.');campaignBy(F,'fight',a,' fled a level '+f.lvl+' '+f.name+' in '+ZONES[f.z]+'.')}}
  if(prev&&prev!=='town'&&st==='town')remember(a,'town','Back in '+homeOf(a).name+' with '+a.gold+'g'+(a.party&&partySlotted(a.party)?', the party with me.':'.'))}

// The record hook (history.js): the hero's own log lines that are worth remembering.
const REC=[[/^Reached level (\d+)/,'level'],[/^Slew /,'kill'],[/^(Became friends|Now counts)/,'bond'],[/^Lost a /,'death'],[/^Looted /,'loot'],
  [/^Completed /,'quest'],[/^(Paid the blood debt|Avenged |Killed )/,'kill']];
onRecord((a,text)=>{const F=companyOf(a);if(!F||!F.slots)return;const r=REC.find(([re])=>re.test(text));if(!r)return;
  if(r[1]==='death'&&F.past.some(p=>text.includes(p.name)))return; // a fallen companion is remembered by onDeath
  remember(a,r[1],text);
  if(r[1]==='level'){const n=+(text.match(/(\d+)/)||[0,0])[1];if(n%5===0)campaignBy(F,'level',a,' reached level '+n+'.')}
  else if(r[1]==='kill')campaignBy(F,'kill',a,': '+text);
  else if(r[1]==='bond')for(const b of slotHeroes(F))if(b!==a&&text.includes(b.name))stanceEvent(a,b,'Lately: '+text)});

// DM beats for the company's adventures: campaign log lines and per-scene memories.
function readDm(F){const L=S.dmLog||[];if(!L.length||L[0].id<=F.dmSeen)return;
  const fresh=[];for(const e of L){if(e.id<=F.dmSeen)break;fresh.push(e)}F.dmSeen=L[0].id;
  for(const e of fresh.reverse()){const ours=(e.heroes||[]).filter(id=>F.ids.includes(id));if(!ours.length)continue;
    const adv=e.advId!=null?(S.adventures||[]).find(v=>v.id===e.advId):null,ttl=adv?adv.title:'the job',txt=plain(e.summary),mem=ours.map(byId).filter(alive);
    if(e.kind==='pick'){campaign(F,'adventure','Took up ',gd(ttl),' at '+(e.town||F.hall)+'.');for(const b of mem)remember(b,'adventure','Took up '+ttl+(adv&&adv.giver?' for '+adv.giver.name:'')+'.');
      const g=adv&&adv.giver;if(g&&g.name&&!F.npcs.includes(g.name)){F.npcs.push(g.name);if(F.npcs.length>40)F.npcs.shift();{const r=g.title||g.role;campaign(F,'npc','Met ',gd(g.name),(r&&!g.name.toLowerCase().includes(String(r).toLowerCase())?', '+r:'')+', in '+(e.town||F.hall)+'.')}}}
    else if(e.kind==='frame')campaign(F,'scene',...e.summary);
    else if(e.kind==='roll'){campaign(F,'roll',...e.summary);for(const b of mem)remember(b,'roll',ttl+': '+txt.replace(/^.*? rolls /,(b.name&&txt.startsWith(b.name)?'I rolled ':'we rolled ')))}
    else if(e.kind==='branch'){campaign(F,'branch',...e.summary);for(const b of mem)remember(b,'scene',ttl+': '+txt)}
    else if(e.kind==='complication')campaign(F,'complication',...e.summary);
    else if(e.kind==='payoff'||e.kind==='fail'||e.kind==='abandon'){campaign(F,'outcome',...e.summary);for(const b of mem)remember(b,'adventure',txt)}}}

function session(F){const d=day();if(d<=F.day)return;const prev=F.day;F.day=d;
  const of=F.log.filter(e=>e.day===prev),n=k=>of.filter(e=>e.kind===k).length;
  const th=openThreads(F);
  campaign(F,'session','Day '+prev+' ends: '+n('adventure')+' job'+(n('adventure')===1?'':'s')+' taken, '+n('outcome')+' finished, '+n('roll')+' rolls, '+n('death')+' fallen. Open threads: '+(th.length?th.length:'none')+'.');
  for(const a of slotHeroes(F))refreshStances(a,F.ids)}

let acc=0;
export function resetCompanyWatch(){fightSeen.clear();lastState.clear();acc=0} // a new world starts the per-hero watch over (#674)
// Once per step: every company's upkeep, then the slotted company's muster, hold, watch and DM beats.
export function slotsTick(dt){companyTick();const F=slotted();if(!F)return;
  enforceAgents(F);
  for(const k of SLOT_KEYS){const id=F.slots[k];if(id==null)continue;const a=byId(id);if(!alive(a))onDeath(F,a||ghost(F,k),k);else (F.last||(F.last={}))[k]={id:a.id,name:a.name,cls:a.cls,lvl:a.lvl}}
  muster(F);
  const P=slotParty(F),L=slotHeroes(F);let holding=false;
  if(P)for(const b of L){if(b.state!=='town'||b.townStep!==2||b.party!==P)continue;
    if(L.some(x=>x!==b&&((x.state==='town'&&x.townStep<2)||x.state==='return'))&&(F.hold||0)<HOLD_MAX){b.wait=Math.max(b.wait,.4);holding=true}}
  F.hold=holding?(F.hold||0)+dt:0;
  for(const a of L)watch(F,a);
  acc+=dt;if(acc>=1){acc=0;readDm(F);session(F)}}

// ---- the Chronicle's "Fellowship only" filter ----
// The company's lines (any member, past or present, or one of their adventures), plus the world's major events:
// Kragmaw, elites in the company's current region, and deaths of their rivals. Guild lines (#341) stay when they name
// a guild a living member belongs to: guilds.js, guildfocus.js and rivals.js write a guild as the part
// {t:'<TAG> Name'}, so the match is on that label. Read-only, no dice.
export const guildLabel=g=>'<'+g.tag+'> '+g.name;
export function chronicleFocus(e,F=slotted()){if(!F)return true;const ps=e.parts||[],L=slotHeroes(F),P=slotParty(F);
  const ids=new Set([...F.ids,...F.past.map(p=>p.id)]);
  const guilds=new Set();for(const a of L)if(a.guild)guilds.add(guildLabel(a.guild));
  const lead=P?P.leader:L[0],z=lead?ZONES[zoneAt(lead.x,lead.y)]:null;
  const rivals=new Set();for(const a of L)for(const id in a.nemesis||{})rivals.add(+id);
  for(const p of ps){if(!p||typeof p!=='object')continue;
    if(p.kind==='hero'&&(ids.has(p.id)||rivals.has(p.id)))return true;
    if(p.adv!=null){const v=(S.adventures||[]).find(x=>x.id===p.adv);if(v&&v.mem&&v.mem.some(id=>ids.has(id)))return true}
    if(typeof p.t==='string'&&(p.t===F.name||guilds.has(p.t)||/Kragmaw/.test(p.t)))return true}
  const text=plain(ps);
  if(z&&ELITES.some(E=>text.includes(E.name))&&text.includes(z))return true;
  return false}
