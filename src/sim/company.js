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
// The Fellowship is a name a company carries. Until the later slices land, the classic five-slot Fellowship is the
// one company that still has `slots` (tank/healer/dps1-3), and the old names stay as shims over this module:
//   S.fellowship         an accessor on S: that company (null when there is none). Not saved under its own key.
//   a.fellow, a.fellowRole   accessors on its members (installed by linkHero): derived from the company, never saved.
//   p.fellow             an accessor on its party (linkParty).
// So every screen and check that reads them keeps working, while saves carry only S.companies / a.company / p.company.
// Solos never become "the Fellowship" through the shim: only a company with slots stands behind S.fellowship.
import {S,clockStr} from './state.js';
import {homeOf} from '../data/races.js';
import {FAC} from '../data/factions.js';
import {bond} from './bonds.js';

export const PARTY={MAX:8,MINDS:5};
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
// The company the watcher follows; the shim behind S.fellowship is the five-slot one (see the header).
export const followed=()=>companyById(S.followId)||companies()[0]||null;
export function fellowshipCompany(){const f=followed();if(f&&f.slots)return f;return (S.companies||[]).find(C=>C.slots)||null}

// ---- the shims ----
Object.defineProperty(S,'fellowship',{enumerable:false,configurable:true,
  get:()=>fellowshipCompany(),
  set:v=>{const L=list();for(let i=L.length-1;i>=0;i--)if(L[i].slots&&L[i]!==v)L.splice(i,1);
    if(v&&!L.includes(v)){L.push(v);L.sort((x,y)=>x.id-y.id)}}});
const FELLOW={enumerable:false,configurable:true,get(){const C=companyOf(this);return !!(C&&C.slots)}};
const ROLE={enumerable:false,configurable:true,get(){const C=companyOf(this);if(!C||!C.slots)return undefined;for(const k in C.slots)if(C.slots[k]===this.id)return k;return undefined}};
export function linkHero(a){if(!a||typeof a!=='object')return a;const d=Object.getOwnPropertyDescriptor(a,'fellow');if(d&&d.get)return a;
  delete a.fellow;delete a.fellowRole;delete a.fellowFrom;Object.defineProperty(a,'fellow',FELLOW);Object.defineProperty(a,'fellowRole',ROLE);return a}
const PFELLOW={enumerable:false,configurable:true,get(){const C=companyById(this.company);return !!(C&&C.slots)}};
export function linkParty(p){if(!p||typeof p!=='object')return p;const d=Object.getOwnPropertyDescriptor(p,'fellow');if(d&&d.get)return p;
  delete p.fellow;Object.defineProperty(p,'fellow',PFELLOW);return p}

// ---- the campaign log (any company) ----
var witnessFn; // no initializer: reach.js may set it while this module is still loading (an import cycle)
export function setWitness(f){witnessFn=f}
export function campaign(C,kind,...parts){if(!C)return null;
  const e={id:C.seq=(C.seq||0)+1,day:day(),t:clockStr(),gameMin:Math.round(S.gameMin),kind,parts};
  C.log.unshift(e);if(C.log.length>LOG_CAP)C.log.pop();if(witnessFn&&C===fellowshipCompany())witnessFn(kind,plain(parts).slice(0,80));return e}
const gd=t=>({t,c:'gd'});
// Open threads: unfinished jobs, meeting plans, living nemeses, oaths still sworn. Computed live, not stored.
export function openThreads(C){if(!C)return [];const out=[],seen=new Set();
  for(const v of S.adventures||[])if(v.phase==='active'&&v.mem&&v.mem.some(id=>C.ids.includes(id)))out.push({kind:'job',parts:['Unfinished job: ',gd(v.title),' (scene '+((v.idx||0)+1)+' of '+((v.scenes||[]).length||'?')+')']});
  for(const p of C.plans||[])if(p.status==='open')out.push({kind:'meeting',parts:['Meeting: ',gd(p.where),' at '+p.atText+' ('+p.whoNames.join(', ')+' know)']}); // #182
  for(const a of members(C)){for(const id in a.nemesis||{}){const n=byId(id);if(alive(n)&&!seen.has(n.id)){seen.add(n.id);out.push({kind:'nemesis',parts:['Blood owed: ',n,' of the '+FAC[n.fac].name+' (',a,' swore it for '+a.nemesis[id]+')']})}}
    if(a.goal&&!a.goal.done)out.push({kind:'oath',parts:[a,' swore to ',gd(a.goal.text.charAt(0).toLowerCase()+a.goal.text.slice(1)),' ('+(a.goal.progress||0)+'/'+a.goal.need+')']})}
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
export function joinCompany(C,a){const bad=refuseJoin(C,a);if(bad)return {ok:false,error:bad};attach(C,a);C.ids.push(a.id);return {ok:true,company:C}}
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
// Every agent-played hero in exactly one company: a solo for one who has none. The five-slot Fellowship's deaths go
// through fellowship.js (onDeath and the replacement); other companies just drop their dead and end when empty.
export function soloFor(a){if(!alive(a)||!a.player||companyOf(a))return companyOf(a);const r=foundCompany([a]);return r.ok?r.company:null}
export function companyTick(){const L=S.companies;if(!L||!L.length)return;
  for(const C of L.slice()){if(C.slots)continue;let gone=false;
    for(const id of C.ids){const a=byId(id);if(!alive(a)){gone=true;if(a){if(a.company===C.id)delete a.company;C.past.push({id:a.id,name:a.name,cls:a.cls,lvl:a.lvl,cause:a.cause||'lost',day:day()})}}}
    if(gone){C.ids=C.ids.filter(id=>alive(byId(id)));if(!C.ids.length)dissolveCompany(C)}}}
// After a load: the accessors on members and company parties, and the one-company rule for agent heroes.
export function relinkCompanies(){if(!Array.isArray(S.companies))S.companies=[];
  for(const a of S.agents||[])if(a&&a.company!=null)linkHero(a);
  for(const p of S.parties||[])if(p&&p.company!=null)linkParty(p);
  for(const a of S.agents||[])if(alive(a)&&a.player&&!companyOf(a))soloFor(a)}
