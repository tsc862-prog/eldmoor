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
import {S,SAVE_VERSION} from './state.js';
import {CRYPT} from '../world/map.js';
import {GOODS,price} from '../data/items.js';
import {rollScores} from './abilities.js';

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
  2:snap=>{for(const a of snap.agents||[])if(a.kind==='hero'&&!a.abil)rollScores(a);return snap}};

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
  for(const k in snap){if(k==='version'||k==='GOODS'||k==='CRYPT'||KEYS[k])continue;
    const v=k in HOMES?alloc[k]:de(snap[k]),cur=S[k];
    if(Array.isArray(cur)&&Array.isArray(v)){cur.length=0;for(const x of v)cur.push(x)}
    else if(k==='boss'&&cur&&v){for(const f in cur)delete cur[f];Object.assign(cur,v)}
    else S[k]=v}
  for(const n in snap.GOODS||{}){const g=GOODS[n],s=snap.GOODS[n];if(!g||!s)continue;g.supply=s.supply;g.prev=s.prev!=null?s.prev:price(n)}
  if(snap.CRYPT){CRYPT.group=de(snap.CRYPT.group);if(snap.CRYPT.cd!=null)CRYPT.cd=snap.CRYPT.cd}
  return S}
