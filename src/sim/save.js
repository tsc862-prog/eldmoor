// Save and load. snapshot() turns the whole of S (plus the auction-house supply from
// data/items.js and the Sunken Crypt group from the world module) into a plain JSON
// object; restore(snap) rebuilds S in place from one, so every module's imported S and
// its arrays (agents, mobs, parties, GUILDS, boss) keep their identity. DOM-free; the
// browser side (localStorage, buttons, auto-save) is src/ui/save.js and the headless
// check is scripts/savecheck.mjs.
//
// Format: {version, <every key of S except fx>, GOODS:{name:{supply,prev}}, CRYPT:{group,cd}}.
// Objects that live in one of the HOMES arrays are written in full there and everywhere
// else as a reference {ref:'hero'|'mob'|'party'|'enc'|'guild', id}; the boss is {ref:'boss'}.
// An entity that is referenced but no longer in its home array (a recycled grave in an
// old chronicle line, a purged mob a hero last looked at) becomes a bare reference, for
// heroes with name and fac so the panels can still print it; restore turns those into
// detached stubs. Functions and canvases never appear in S (savecheck asserts it).
import {S,SAVE_VERSION,newWorldId} from './state.js';
import {CRYPT} from '../world/map.js';
import {GOODS,MATERIALS,price} from '../data/items.js';
import {rollScores} from './abilities.js';
import {convertItem} from './gear.js';
import {convertBag} from './inv.js';
import {reserveNames} from '../data/races.js';
import {normalizeProfs} from './professions.js';
import {ensureCampaign} from './dmagent.js';
import {relinkCompanies} from './company.js';
import {homeOf} from '../data/races.js';

export {SAVE_VERSION};

// Where each kind of entity lives on S. Guilds carry a numeric id (S.guildSeq) that is never reused.
const HOMES={agents:'hero',mobs:'mob',parties:'party',encounters:'enc',GUILDS:'guild'};
const idOf=(kind,o)=>o.id;
// Per-key handlers for keys of S that are not just walked. A handler returning undefined
// drops the key from the save; `reset` is what restore does to it instead.
const KEYS={
  fx:{save:()=>undefined,reset:()=>{S.fx.length=0}}, // transient damage text, bolts and rings
};
// Older versions step through here one at a time: MIGRATIONS[v] takes a version-v snapshot
// to version v+1. Empty for now.
// v1 -> v2: guilds were keyed by tag; give them numeric ids (dynamic guilds, #56).
const MIGRATIONS={1:snap=>{const ids={};(snap.GUILDS||[]).forEach((g,i)=>{ids[g.tag]=g.id=i+1;g.founded=0;g.leaderId=null;g.retired=false});snap.guildSeq=(snap.GUILDS||[]).length;
  const walk=v=>{if(!v||typeof v!=='object')return;if(Array.isArray(v)){v.forEach(walk);return}
    if(v.ref==='guild'&&ids[v.id]!==undefined)v.id=ids[v.id];else for(const k in v)walk(v[k])};walk(snap);return snap},
  // v2 -> v3: heroes gain ability scores and skill training (abilities, #80); growth for levels already reached is replayed.
  2:snap=>{for(const a of snap.agents||[])if(a.kind==='hero'&&!a.abil)rollScores(a);return snap},
  // v3 -> v4: the Fellowship (#68) adds S.fellowship and a.fellow/persona/backstory/memory; older saves simply have none.
  3:snap=>snap,
  // v4 -> v5: items lose Vigor/Might/Guard/Precision/Haste and carry armor, damage, score bonuses and a
  // rare property instead (stat cleanup, #88); the hero's cached stat totals go.
  4:snap=>{for(const a of snap.agents||[]){if(a.kind!=='hero')continue;delete a.gtot;
    for(const k in a.slots||{})if(a.slots[k])convertItem(a.slots[k],a.cls);
    for(const it of a.bag||[])if(it&&typeof it==='object')convertItem(it,a.cls)}return snap},
  // v5 -> v6: the trade-goods bag becomes the pack a.inv (inventory, #124): stacks, spare gear, consumables, quest items.
  5:snap=>{for(const a of snap.agents||[])if(a.kind==='hero'&&!a.inv)convertBag(a);return snap},
  // v6 -> v7: companies (#402, #438). The Fellowship singleton becomes S.companies[0] (its old id kept as the name seed),
  // a.fellow/a.fellowRole/a.fellowFrom become a.company (role from the slot, home town in C.from), p.fellow becomes
  // p.company, S.fellowshipsPast becomes S.companiesPast, and every living agent hero with no company becomes a solo.
  6:snap=>migrateCompanies(snap)};
function migrateCompanies(snap){let seq=0;const companies=[],day=Math.floor((snap.gameMin||0)/1440)+1;
  const F=snap.fellowship,heroes=(snap.agents||[]).filter(a=>a&&a.kind==='hero');
  if(F&&typeof F==='object'){const C={...F,id:++seq,seed:F.id,from:{}};const ids=new Set((F.ids||[]).map(String));
    for(const a of heroes){if(ids.has(String(a.id))){a.company=C.id;if(a.fellowFrom!=null)C.from[a.id]=a.fellowFrom}}
    for(const p of snap.parties||[])if(p&&p.fellow)p.company=C.id;
    companies.push(C);snap.followId=C.id}
  for(const a of heroes){delete a.fellow;delete a.fellowRole;delete a.fellowFrom}
  for(const p of snap.parties||[])if(p)delete p.fellow;
  for(const a of heroes)if(a.player&&a.state!=='dead'&&a.company==null){const C={id:++seq,name:a.name,fac:a.fac,hall:homeOf(a).name,ids:[a.id],
    founded:Math.round(snap.gameMin||0),day,log:[],past:[],npcs:[],seq:0};a.company=C.id;companies.push(C)}
  if(snap.fellowshipsPast)snap.companiesPast=snap.fellowshipsPast;
  delete snap.fellowship;delete snap.fellowshipsPast;
  snap.companies=companies;snap.companySeq=seq;if(snap.followId===undefined)snap.followId=null;return snap}

// ---- snapshot ----
export function snapshot(){
  const refs=new Map();
  for(const k in HOMES)for(const o of S[k]||[])refs.set(o,{ref:HOMES[k],id:idOf(HOMES[k],o)});
  refs.set(S.boss,{ref:'boss'});
  const ser=(v,home)=>{
    if(v===null||typeof v!=='object')return v;
    if(!home){const r=refs.get(v);if(r)return {...r};
      if(v.kind==='hero')return {ref:'hero',id:v.id,name:v.name,fac:v.fac};
      if(v.kind==='mob'||v.kind==='enc')return {ref:v.kind,id:v.id}}
    if(Array.isArray(v)){const out=new Array(v.length);for(let i=0;i<v.length;i++)out[i]=ser(v[i],false);return out}
    const o={};for(const k in v){const x=v[k];if(x===undefined||typeof x==='function')continue;o[k]=ser(x,false)}return o};
  const snap={version:SAVE_VERSION};
  for(const k of Object.keys(S)){
    if(KEYS[k]){const v=KEYS[k].save(S[k],ser);if(v!==undefined)snap[k]=v;continue}
    snap[k]=k in HOMES?(S[k]||[]).map(o=>ser(o,true)):ser(S[k],false)}
  snap.GOODS={};for(const n in GOODS)snap.GOODS[n]={supply:GOODS[n].supply,prev:GOODS[n].prev};
  snap.MATS={};for(const n in MATERIALS)snap.MATS[n]={supply:MATERIALS[n].supply,prev:MATERIALS[n].prev}; // gathered materials sold at the auction house (#257)
  snap.CRYPT={group:ser(CRYPT.group,false),cd:CRYPT.cd};
  return snap}

// ---- restore ----
export const isSave=snap=>!!(snap&&typeof snap==='object'&&typeof snap.version==='number'&&Array.isArray(snap.agents)&&typeof snap.gameMin==='number');

function migrate(snap){let v=snap.version;
  while(v<SAVE_VERSION){const m=MIGRATIONS[v];if(m)snap=m(snap)||snap;v++}
  if(snap.version!==SAVE_VERSION)snap.version=SAVE_VERSION;return snap}

export function restore(snap){
  if(!isSave(snap))throw new Error('Not an Eldmoor save');
  if(snap.version>SAVE_VERSION)throw new Error('Save version '+snap.version+' is newer than this build ('+SAVE_VERSION+')');
  snap=migrate(snap);
  // Pass 1: allocate every entity so references can be resolved in any order.
  const pools={},alloc={};
  for(const k in HOMES){const kind=HOMES[k],pool=pools[kind]=new Map();
    alloc[k]=(snap[k]||[]).map(e=>{const o={};pool.set(String(idOf(kind,e)),o);return o})}
  const stubs=new Map();
  const resolve=r=>{if(r.ref==='boss')return S.boss;
    const pool=pools[r.ref],o=pool&&pool.get(String(r.id));if(o)return o;
    const key=r.ref+':'+r.id;if(!stubs.has(key)){const s={kind:r.ref};for(const k in r)if(k!=='ref')s[k]=r[k];
      if(r.ref==='hero')s.state='dead';else if(r.ref==='mob'){s.alive=false;s.gone=true}stubs.set(key,s)}return stubs.get(key)};
  const de=v=>{if(v===null||typeof v!=='object')return v;if(Array.isArray(v))return v.map(de);
    if(typeof v.ref==='string'&&(v.ref==='boss'||pools[v.ref]))return resolve(v);
    const o={};for(const k in v)o[k]=de(v[k]);return o};
  // Pass 2: fill the entities, then put every key back on S. Arrays and the boss are
  // refilled in place; everything else is replaced.
  for(const k in HOMES)(snap[k]||[]).forEach((e,i)=>{const o=alloc[k][i];for(const f in e)o[f]=de(e[f])});
  for(const k of Object.keys(S)){if(KEYS[k])KEYS[k].reset();else if(!(k in snap))delete S[k]}
  for(const k in snap){if(k==='version'||k==='GOODS'||k==='MATS'||k==='CRYPT'||KEYS[k])continue;
    const v=k in HOMES?alloc[k]:de(snap[k]),cur=S[k];
    if(Array.isArray(cur)&&Array.isArray(v)){cur.length=0;for(const x of v)cur.push(x)}
    else if(k==='boss'&&cur&&v){for(const f in cur)delete cur[f];Object.assign(cur,v)}
    else S[k]=v}
  for(const n in snap.GOODS||{}){const g=GOODS[n],s=snap.GOODS[n];if(!g||!s)continue;g.supply=s.supply;g.prev=s.prev!=null?s.prev:price(n)}
  for(const n in MATERIALS){const g=MATERIALS[n],s=snap.MATS&&snap.MATS[n];g.supply=s?s.supply:6;g.prev=s&&s.prev!=null?s.prev:price(n)} // an older save: the table's opening stock
  if(snap.CRYPT){CRYPT.group=de(snap.CRYPT.group);if(snap.CRYPT.cd!=null)CRYPT.cd=snap.CRYPT.cd}
  if(!S.worldId)S.worldId=newWorldId(); // an older save gets its instance id on load
  for(const a of S.agents||[])if(a.profs!==undefined)normalizeProfs(a); // a.profs is optional (professions, #254): absent reads as [], present is cleaned
  reserveNames(S.agents||[],S.fallen||[]); // names stay unique after a reload (no two Loreths)
  relinkCompanies(); // a.fellow / p.fellow accessors on company members and parties; agent heroes without a company ride as solos
  ensureCampaign(); // an older save whose DM notes are empty gets the campaign seed once
  return S}

// ---- a short description of a save, for the title screen (read-only, never changes S) ----
// {day, min, heroes, fellowship:{name, members:[{slot, name, cls, lvl, fac, race, skin, hair, dead}]}|null,
//  companies:[{id, name, fac, solo, members:[{name, cls, lvl, dead}]}]} (a v6 save, not yet migrated, lists its Fellowship)
const SLOT_ORDER=['tank','healer','dps1','dps2','dps3'];
export function describeSave(snap){if(!isSave(snap))return null;
  const byId=new Map();for(const a of snap.agents)if(a&&a.kind==='hero')byId.set(String(a.id),a);
  const CS=Array.isArray(snap.companies)?snap.companies:[];
  const F=snap.fellowship||CS.find(c=>c&&c.slots)||null;let fellowship=null;
  if(F&&F.slots&&typeof F.slots==='object'){const rank=k=>{const i=SLOT_ORDER.indexOf(k);return i<0?99:i},keys=Object.keys(F.slots).sort((a,b)=>rank(a)-rank(b));
    const members=[];for(const k of keys){const h=F.slots[k]!=null&&byId.get(String(F.slots[k]));
      if(h)members.push({slot:k,name:h.name,cls:h.cls,lvl:h.lvl,fac:h.fac,race:h.race,skin:h.skin,hair:h.hair,dead:h.state==='dead'})}
    fellowship={name:F.name||'',members}}
  const companies=(CS.length?CS:F?[F]:[]).filter(c=>c&&Array.isArray(c.ids)).map(c=>{const ms=c.ids.map(id=>byId.get(String(id))).filter(Boolean);
    return {id:c.id,name:c.name||'',fac:c.fac,solo:c.ids.length===1,members:ms.map(h=>({name:h.name,cls:h.cls,lvl:h.lvl,dead:h.state==='dead'}))}});
  return {day:Math.floor(snap.gameMin/1440)+1,min:Math.floor(snap.gameMin)%1440,
    heroes:byId.size?[...byId.values()].filter(a=>a.state!=='dead').length:0,fellowship,companies}}
