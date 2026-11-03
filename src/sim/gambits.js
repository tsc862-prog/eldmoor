// Gambits (issue #617): an agent hero's own ordered rules, "if <condition> then <action>", which its autopilot and its
// reflexes run between the agent's turns. The vocabulary and the class presets are data (data/gambits.js); the presets
// are today's hard-coded policy written out rule for rule, so a hero whose list was never edited plays exactly as before.
// Scripted heroes never come here (sim/player.js only calls this for a.player heroes).
//
// The engine knows the order and the phases; what each condition and action does lives where its helpers are:
// conditions that read only the world are here, the rest and every action are given by sim/player.js (defineGambits),
// so this module imports nothing of player.js. No RNG: conditions only read, and the actions are the code paths the
// hard-coded policy took.
//   idlePick(a, ctx)    autopilot: the first rule that holds and can run; returns a command (or list), or null
//   fightRules(a, ctx)  every moment of a fight: each fight rule that holds acts in turn; flee/retreat/hold end it
//   reflexPick(a, ctx)  idle in the field with no order: only sell_loot rules (the full-pack reflex)
import {GAMBIT,CONDS,ACTS,PRESET_IDLE,PRESET_FIGHT,PRESET_HEAL,PRESET_GUARD,TANK_CLASSES} from '../data/gambits.js';
import {CLS} from '../data/classes.js';
import {S} from './state.js';
import {zoneAt,dist,REGIONS} from '../world/map.js';
import {weatherKind,isStorm} from './weather.js';
import {companyOf,inSlots} from './company.js';
import {openProps,leaderFor} from './council.js';
import {feared} from './lore.js';
import {nearMobs} from './spatial.js';
import {maxHp} from './heroes.js';
import {tm} from '../data/traits.js';

const IMPL={c:{},a:{}};
// sim/player.js hands over the conditions that need its helpers and every action: {conds:{name:fn}, acts:{name:fn}}.
// A condition fn(a, args, ctx) returns falsy, true, or the hero it names (the target of heal/guard). An action fn(a, args,
// ctx) returns null when it cannot run here (the next rule is tried); between turns a command (or a list) or HOLD; in a
// fight true when it acted, 'end' when it acted and ends the moment.
export function defineGambits({conds={},acts={}}){Object.assign(IMPL.c,conds);Object.assign(IMPL.a,acts)}
export const HOLD={hold:true};

// ---- presets ----
const PRE={};
const clone=r=>JSON.parse(JSON.stringify(r));
// The class preset: fight rules (a healer's heal first, a tank's guard suggestion, off), then the between-turns rules.
export function presetFor(cls,name='class'){const k=cls+'|'+name;if(PRE[k])return PRE[k];
  let L=[...(CLS[cls]&&CLS[cls].heal?[PRESET_HEAL]:[]),...(TANK_CLASSES.includes(cls)?[PRESET_GUARD]:[]),...PRESET_FIGHT,...PRESET_IDLE];
  if(name==='cautious')L=L.flatMap(r=>r.when==='past_flee_mark'?[{when:'self_hp_below',w:{pct:35},then:'flee_home'},r]:[r]);
  if(name==='empty')L=[];
  const out=L.map((r,i)=>Object.freeze({id:i+1,...clone(r),on:r.on!==false}));
  return PRE[k]=Object.freeze(out)}
// The hero's rules: its own list once it edited one, else its class preset (shared and frozen; never stored on the hero).
export const rulesOf=a=>a.gambits||presetFor(a.cls);
export const edited=a=>!!a.gambits;

// ---- runtime record (not saved: non-enumerable, like the action log) ----
function rec(a){let g=a._gb;if(!g){g={last:null,n:0,log:[],at:{},once:{}};Object.defineProperty(a,'_gb',{value:g,enumerable:false,writable:true,configurable:true})}return g}
export const gambitRec=(a,make)=>a?(make?rec(a):a._gb||null):null;
// One fire: the last rule that acted (the Agent tab highlights it), a short log of changes, a count of rule-driven acts.
function fired(a,r,phase){const g=rec(a),same=g.last&&g.last.id===r.id&&S.gameMin-g.last.at<30;
  g.last={id:r.id,when:r.when,and:r.and||null,then:r.then,at:S.gameMin,phase};g.at[r.id]=S.gameMin;
  if(!same){g.n++;g.log.push({id:r.id,text:ruleText(r),at:Math.round(S.gameMin),phase});if(g.log.length>GAMBIT.LOG)g.log.shift()}}

// ---- conditions that read only the world ----
const pctOf=(x,p)=>x.hp<maxHp(x)*(p/100);
const leaderNear=a=>{const L=leaderFor(a)||(a.party&&a.party.leader!==a?a.party.leader:null);return L&&L!==a&&L.state!=='dead'&&!L.hidden?L:null};
const mates=a=>{const C=companyOf(a),ids=C?C.ids:[];const L=[];for(const id of ids){if(id===a.id)continue;const b=S.agents.find(x=>x.id===id);if(b)L.push(b)}
  if(a.party)for(const b of a.party.mem)if(b!==a&&!L.includes(b))L.push(b);return L};
const SEE=12;
const BASE={
  always:()=>true,
  self_hp_below:(a,w)=>a.hp<maxHp(a)*(num(w.pct,1,99,50)/100)*(w.scale==='retreat'||w.scale==='flee'?tm(a,w.scale):1),
  ally_hp_below:(a,w)=>{const p=num(w.pct,1,99,50),who=String(w.who||'').toLowerCase();let low=null;
    for(const b of mates(a)){if(b.state==='dead'||b.state==='ghost'||b.hidden||dist(a,b)>SEE)continue;if(who&&b.name.toLowerCase().split(' ')[0]!==who.split(' ')[0])continue;
      if(pctOf(b,p)&&(!low||b.hp/maxHp(b)<low.hp/maxHp(low)))low=b}return low},
  leader_hp_below:(a,w)=>{const L=leaderNear(a);return L&&dist(a,L)<=SEE&&pctOf(L,num(w.pct,1,99,50))?L:null},
  foe_is:(a,w,ctx)=>{const m=ctx&&ctx.m||(a.state==='fight'?a.target:null);if(!m||m.kind!=='mob')return false;const k=w.what;
    return k==='elite'?!!m.elite:k==='named'?!!m.named:k==='above_my_level'?m.lvl>a.lvl:k==='known_dangerous'?!!feared(a,m):false},
  foes_more_than:(a,w)=>{const n=num(w.n,1,9,1);let k=0;for(const m of nearMobs(a.x,a.y,8))if(m.alive&&!m.gone&&m.target===a)k++;return k>n},
  in_fight:a=>a.state==='fight',
  attacked:(a,w,ctx)=>{const m=ctx&&ctx.m;if(m&&m.target===a)return true;for(const x of nearMobs(a.x,a.y,6))if(x.alive&&!x.gone&&x.target===a)return true;return false},
  in_town:a=>a.state==='town',
  at_camp:a=>{const C=companyOf(a),g=C&&C.camp;return !!(g&&g.phase&&g.ids&&g.ids.includes(a.id))},
  night:()=>{const h=(S.gameMin/60)%24;return h<5||h>=21},
  storm_or_fog:a=>{const z=zoneAt(a.x,a.y);return isStorm(z)||weatherKind(z)==='fog'},
  storm:a=>isStorm(zoneAt(a.x,a.y)),
  apart_from_leader:(a,w)=>{const L=leaderNear(a);return !!L&&dist(a,L)>num(w.tiles,2,40,12)},
  leader_moving:a=>{const L=leaderNear(a);return !!(L&&L.moving)},
  level_below_region:a=>{const R=REGIONS[zoneAt(a.x,a.y)],b=R&&R.band;return !!(b&&b[0]>a.lvl)},
  gold_above:(a,w)=>(a.gold||0)>num(w.n,0,1e6,100),
  vote_open:a=>inSlots(a)&&openProps().length>0,
};
const num=(v,lo,hi,d)=>{const n=Math.round(Number(v));return Number.isFinite(n)?Math.min(hi,Math.max(lo,n)):d};
function cond(a,name,w,ctx){const f=IMPL.c[name]||BASE[name];return f?f(a,w||{},ctx):false}
// Both conditions of a rule; the hero either one names is the target (the first one's when both do).
function holds(a,r,ctx){const c1=cond(a,r.when,r.w,ctx);if(!c1)return null;if(!r.and)return c1;const c2=cond(a,r.and,r.w2,ctx);if(!c2)return null;return c1!==true?c1:c2}

// ---- the three phases ----
export function idlePick(a,ctx){const L=rulesOf(a);
  for(let i=0;i<L.length;i++){const r=L[i];if(r.on===false)continue;const A=ACTS[r.then];if(!A||A.phase==='fight')continue;
    const hit=holds(a,r,ctx);if(!hit)continue;const f=IMPL.a[r.then];if(!f)continue;ctx.hit=hit;ctx.rule=r;
    const out=f(a,r.t||{},ctx);if(out==null)continue;fired(a,r,'idle');return out===HOLD?null:out}
  return null}
export function fightRules(a,ctx){const L=rulesOf(a);
  for(let i=0;i<L.length;i++){const r=L[i];if(r.on===false)continue;const A=ACTS[r.then];if(!A||A.phase==='idle')continue;
    const hit=holds(a,r,ctx);if(!hit)continue;const f=IMPL.a[r.then];if(!f)continue;ctx.hit=hit;ctx.rule=r;
    const out=f(a,r.t||{},ctx);if(!out)continue;fired(a,r,'fight');if(out==='end'||out===HOLD)return}}
export function reflexPick(a,ctx){const L=rulesOf(a);
  for(let i=0;i<L.length;i++){const r=L[i];if(r.on===false||r.then!=='sell_loot')continue;const hit=holds(a,r,ctx);if(!hit)continue;
    const f=IMPL.a.sell_loot;ctx.hit=hit;ctx.rule=r;ctx.reflex=true;const out=f&&f(a,r.t||{},ctx);if(out==null)continue;fired(a,r,'reflex');return out===HOLD?null:out}
  return null}

// ---- words ----
const argText=o=>{const k=o?Object.keys(o):[];return k.length?' {'+k.map(x=>x+': '+o[x]).join(', ')+'}':''};
export const condText=(c,w)=>c+argText(w);
export const ruleText=r=>condText(r.when,r.w)+(r.and?' and '+condText(r.and,r.w2):'')+' -> '+r.then+argText(r.t);
export {GAMBIT,CONDS,ACTS};
