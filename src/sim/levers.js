// DM world levers (issue #77, epic #62): the fixed, validated set of actions the DM uses to
// change the world. The scripted DM (sim/dm.js) pulls them by template; a model-backed DM or
// an agent calls them by name with parameters. Every pull is validated (types, enums, ranges,
// the region's level band, walkable tiles, distance from towns), held to hard limits and a
// cooldown, applied by deterministic scripted code here, and written to the DM log (kind
// 'lever') with its parameters, reason and result. Illegal pulls are rejected with a reason
// and logged the same way. Owned by ai-designer.
//
// What no lever can do, by construction: kill or save a hero, touch HP, XP, level, stats,
// class or the hardcore rule, rewrite terrain (places are markers on top of it), or hand out
// loot outside the item tables. register() refuses a lever whose parameters name those things,
// and levercheck asserts that pulling every lever leaves every hero's numbers unchanged.
//
// ---- a lever ----
//   {name, params:{key:{type, ...}}, limits:{maxActive, perDay, perRegionPerDay}, cooldown (game min),
//    region(p)?, check(p, ctx)? -> error string, apply(p, ctx) -> {ok, effect, undo?, until?, ret?},
//    expire(rec)?, describe(p) -> string}
//   types: int|num (min, max), enum (values), str (max), bool, region (index or name),
//   town (name), point ({x,y}), id; `def` is the default, `opt` makes it optional.
//
// ---- state (plain JSON on S, saved as-is) ----
//   S.levers     {seq, active:[rec], cd:{key:gameMin}, day:{d, n:{name:k}, rz:{name:z:k}}, stats}
//                rec: {id, name, params, region, by, reason, born, until, undo, effect}
//   S.places     markers: {id, kind, name, x, y, z, born, until, lever}
//   S.marks      danger and cleared areas: {id, kind:'danger'|'cleared', x, y, r, z, lvl, until, lever}
//   S.conditions region conditions: {id, kind, z, str, until, lever}
//   S.wanderers  NPCs the DM placed outside the town rosters (drawn and voiced like townsfolk)
//   Attitudes live on the NPC itself: p.att = [{to:'hero'|'party'|'faction', id, a, until, lever}].
//
// ---- the world reads levers through these hooks (no RNG unless a mark or condition applies) ----
//   encRate()  encounter spawn-rate multiplier     encKind(p,kind)  ambush bias at a road spot
//   encSpot(spots) a spot inside a danger area     sightLever(z)    fog-bound sight multiplier
//   presence(town) townsfolk greeting multiplier   attitudeOf(p,heroes) / attitudeDc(adv,at,heroes)
import {clamp} from '../core/rng.js';
import {W,H,ROAD,WALKABLE} from '../world/tiles.js';
import {solidAt,solidWhy,nearestOpen} from '../world/passable.js';
import {tiles,I,ZONES,REGIONS,CITY,LANDMARKS,zoneAt,zoneFor,dist} from '../world/map.js';
import {MOBS} from '../data/mobs.js';
import {GOODS,QUEST_ITEMS,USES,EPICS,BOSS_EPICS,DG_EPICS,SLOTS} from '../data/items.js';
import {addQuest,addUse,addGear,take,room,count} from './inv.js';
import {makeItem} from './gear.js';
import {notify} from './notify.js';
import {RACES} from '../data/races.js';
import {npcRole,WANDER_ROLES} from '../data/npcs.js';
import {BEAST,ADVENTURES,SUPPLY} from '../data/adventures.js';
import {S} from './state.js';
import {sceneOf} from './scenes.js';
import {takeProp} from './props.js'; // the scene prop that held the item is gone (#592)
import {dmlog} from './dmlog.js';
import {focuses,pullTouchesAny,reserveOf,fairRefusal} from './dmfocus.js'; // the companies' reserved share of the daily limits (issues #165, #450)
import {timeline,record} from './history.js';
import {npcSay,ensureNpcs} from './npcs.js';
import {moveTo} from './heroes.js';
import {spawnMob} from './mobs.js';
import {postHook,withdrawHook} from './dm.js';
import {postSupply,withdrawSupply,openAt as supplyOpenAt,SUP} from './supply.js'; // goods jobs (#720): post_hook takes their names as tpl
import {customFoe,spawnFoe} from './encounterbuilder.js';
import {blockOf,NAMED_KITS,ROLES} from '../data/bestiary.js';
import {CUSTOM} from '../data/encounter-tables.js';
import {SITE_THEME_IDS} from '../data/sites.js';

// ---- knobs ----
export const LK={
  TOWN_CLEAR:8,      // tiles a camp, place or mark keeps from every town gate
  PLACE_GAP:3,       // tiles between two places
  BOARD_MAX:8,       // open hooks a town board may hold (scripted refill keeps 3 posted)
  DANGER_MOBS:2,     // extra monsters kept in a danger area
  MIGRATE_MOBS:2,    // extra monsters per strength point of a migration
  ECO_T:5,           // real seconds between lever ecology passes
  TL_PER_DAY:2,      // timeline entries the levers may write per game day
  REASON_MAX:160,
  EAR:7,             // tiles within which a person can hand a hero an item (give_item by)
  GEAR_PER_DAY:1,    // plain gear pieces give_item may hand out a game day
};
const BY=['scripted','model','agent','dm-agent']; // dm-agent: the DM played by an agent (sim/dmagent.js, issue #66)
const DAY=1440;
// Parameter names no lever may have: the hero's numbers, life and death, and loot.
const FORBIDDEN=/^(hp|maxhp|xp|lvl_?up|level_?up|stats?|abil|cls|class|hardcore|kill|slay|revive|resurrect|save_?hero|loot|item|epic|gold_?grant|gear)$/i;

// Private LCG for cosmetic picks (names, looks, strolls): never perturbs the gameplay RNG.
const SEED0=0x2545f491;let seed=SEED0;export const resetLeverSeed=()=>{seed=SEED0}; // init() puts the private stream back (#674)
const r=()=>{seed=(Math.imul(seed,1103515245)+12345)&0x7fffffff;return seed/0x80000000};
const pickR=a=>a[Math.floor(r()*a.length)];

// ---- state ----
export function ensureLevers(){
  if(!S.levers)S.levers={seq:0,active:[],cd:{},day:{d:-1,n:{},rz:{}},stats:{pulled:{},rejected:{},why:{},tl:{}},ecoT:LK.ECO_T};
  if(!S.places)S.places=[];if(!S.marks)S.marks=[];if(!S.conditions)S.conditions=[];if(!S.wanderers)S.wanderers=[];
  return S.levers}
const day=()=>Math.floor(S.gameMin/DAY);
function today(){const L=S.levers;if(L.day.d!==day())L.day={d:day(),n:{},rz:{},nf:{}};return L.day}
const bump=(o,k,n=1)=>{o[k]=(o[k]||0)+n};
const band=z=>REGIONS[z]&&REGIONS[z].band?REGIONS[z].band:[1,99];
const bandHi=z=>Math.min(band(z)[1],60);
const gd=t=>({t,c:'gd'});
const hrs=m=>{const h=Math.max(0,Math.round(m/60));return h>=24?Math.floor(h/24)+'d'+(h%24?' '+h%24+'h':''):h+'h'};

// ---- validation ----
const isNum=v=>typeof v==='number'&&Number.isFinite(v);
function townOf(v){return typeof v==='string'?CITY.find(c=>c.name.toLowerCase()===v.toLowerCase())||null:null}
function regionOf(v){if(isNum(v)&&Number.isInteger(v)&&v>=0&&v<ZONES.length)return v;
  if(typeof v==='string'){const i=ZONES.findIndex(z=>z.toLowerCase()===v.toLowerCase());if(i>=0)return i}return null}
// One parameter: returns [value] or an error string.
function field(k,s,v){
  if(v===undefined||v===null||v===''){if('def' in s)return [typeof s.def==='function'?s.def():s.def];if(s.opt)return [undefined];return k+' is required'}
  switch(s.type){
  case 'int':case 'num':{if(!isNum(v))return k+' must be a number';if(s.type==='int'&&!Number.isInteger(v))return k+' must be a whole number';
    if(s.min!=null&&v<s.min||s.max!=null&&v>s.max)return k+' must be '+s.min+'-'+s.max;return [v]}
  case 'enum':return s.values.includes(v)?[v]:k+' must be one of '+s.values.join(', ');
  case 'str':{if(typeof v!=='string')return k+' must be text';const t=v.replace(/[\u0000-\u001f<>{}]/g,'').trim().slice(0,s.max||40);return t?[t]:k+' is empty'}
  case 'bool':return typeof v==='boolean'?[v]:k+' must be true or false';
  case 'region':{const z=regionOf(v);return z==null?k+' must be a region ('+ZONES.join(', ')+')':[z]}
  case 'town':{const c=townOf(v);return c?[c.name]:k+' must be a town ('+CITY.map(c=>c.name).join(', ')+')'}
  case 'point':return v&&isNum(v.x)&&isNum(v.y)?[{x:Math.round(v.x*10)/10,y:Math.round(v.y*10)/10}]:k+' must be a point {x,y}';
  case 'id':return isNum(v)&&Number.isInteger(v)?[v]:k+' must be an id';
  case 'obj':return v&&typeof v==='object'&&!Array.isArray(v)?[JSON.parse(JSON.stringify(v))]:k+' must be an object';
  default:return k+' has an unknown type'}}
export function validate(def,raw){const p={};raw=raw&&typeof raw==='object'?raw:{};
  for(const k in raw)if(!(k in def.params))return 'unknown parameter '+k;
  for(const k in def.params){const x=field(k,def.params[k],raw[k]);if(typeof x==='string')return x;if(x[0]!==undefined)p[k]=x[0]}return p}
// A spot on the map: in bounds, walkable (or a road), outside the towns and clear of their gates
// and of the lair and crypt. Returns null when legal, else why not.
export function spotErr(p,o={}){
  if(!(p.x>=1&&p.y>=1&&p.x<W-1&&p.y<H-1))return 'off the map';
  const t=tiles[I(Math.floor(p.x),Math.floor(p.y))];
  if(o.road&&t!==ROAD)return 'not a road tile';
  // solid ground (#792): the passability layer is the one way to ask; the refusal names the nearest spot that passes
  const hint=()=>{if(o._hint)return '';const q=nearestOpen(p.x,p.y,12,s=>!spotErr(s,{...o,_hint:1}));return q?'; nearest open ground is '+q.x+','+q.y:'; no open ground within 12 tiles'};
  if(solidAt(p.x,p.y))return 'solid ground ('+solidWhy(p.x,p.y)+')'+hint();
  if(!WALKABLE.includes(t))return 'not a walkable tile'+hint();
  const c=CITY.find(c=>p.x>=c.x0-1&&p.x<=c.x1+1&&p.y>=c.y0-1&&p.y<=c.y1+1);if(c)return 'inside '+c.name;
  const g=CITY.find(c=>dist(p,c.gate)<(o.clear||LK.TOWN_CLEAR));if(g)return 'within '+(o.clear||LK.TOWN_CLEAR)+' tiles of '+g.name+'’s gate';
  for(const l of LANDMARKS)if(l.exclude&&dist(p,l)<l.exclude+1)return 'on '+l.name;
  if(o.region!=null&&zoneAt(p.x,p.y)!==o.region)return 'outside '+ZONES[o.region];
  return null}
// A level for a region: up to 3 outside the band is pulled into it (to the band's top + 2);
// further out is refused, so nothing level-40 ever walks Thornvale.
export function bandLvl(z,lvl){const [lo]=band(z),hi=bandHi(z);
  if(lvl<lo-3||lvl>hi+3)return {err:'level '+lvl+' is outside '+ZONES[z]+'’s band '+lo+'-'+(band(z)[1]===Infinity?'+':band(z)[1])};
  return {lvl:clamp(lvl,lo,hi+2),clamped:lvl<lo||lvl>hi+2}}

// ---- the registry ----
export const LEVERS={};
const IMPL={}; // implementations other systems provide for the stub levers (a future createSite, startEvent, nudgeRelation)
export function register(def){
  if(!def||typeof def.name!=='string'||typeof def.apply!=='function')throw new Error('lever needs a name and apply()');
  for(const k in def.params||{})if(FORBIDDEN.test(k)&&!(def.allow||[]).includes(k))throw new Error('lever '+def.name+': parameter '+k+' is not allowed (heroes’ numbers, life and loot are off limits)');
  if(FORBIDDEN.test(def.name))throw new Error('lever name '+def.name+' is not allowed');
  def.params=def.params||{};def.limits=def.limits||{};def.cooldown=def.cooldown||0;LEVERS[def.name]=def;return def}
// Another system provides an implementation a stub lever calls (provide('createSite', fn)).
export function provide(name,fn){IMPL[name]=fn}
// The menu for a model or agent: names, parameter schemas and limits as plain JSON.
export function leverMenu(){return Object.values(LEVERS).map(d=>({name:d.name,about:d.about||'',params:JSON.parse(JSON.stringify(d.params,(k,v)=>v===Infinity?null:typeof v==='function'?undefined:v)),limits:{...d.limits},cooldown:d.cooldown,available:!d.stub||!!IMPL[d.stub]}))}
export const activeOf=name=>(S.levers?S.levers.active:[]).filter(x=>x.name===name);
// One lever's contract in a line, for error messages (issue #401): "post_hook takes params: town (a town: Highgate|...),
// tpl (rescue|escort|...), giver? (...), reward=fair (small|fair|generous)". ? = optional, =x = default. Read only.
export function leverUsage(name){const def=LEVERS[name];if(!def)return '';
  const kind=s=>{const v=s.values||[];switch(s.type){case 'enum':return v.length>12?v.slice(0,12).join('|')+'|...':v.join('|');
    case 'region':return 'a region: '+ZONES.join('|');case 'town':return 'a town: '+CITY.map(c=>c.name).join('|');case 'point':return '{"x":N,"y":N}';
    case 'int':case 'num':return 'number'+(s.min!=null?' '+s.min+'-'+s.max:'');case 'str':return 'text';case 'bool':return 'true|false';case 'id':return 'an id';case 'obj':return 'object';default:return s.type}};
  const ps=Object.entries(def.params).filter(([k])=>!(def.hide||[]).includes(k)).map(([k,s])=>k+(s.opt?'?':'def' in s&&typeof s.def!=='function'?'='+s.def:'def' in s?'?':'')+' ('+kind(s)+')');
  return name+' takes params: '+(ps.length?ps.join(', '):'none')}
// The lever names a caller can pull now (stubs without an implementation left out).
export const leverNames=()=>Object.values(LEVERS).filter(d=>!d.stub||IMPL[d.stub]||d.native).map(d=>d.name);

// ---- pull ----
// pull(name, params, {by, reason, adv, log}) -> {ok, id, effect, until, ret} or {ok:false, reason}.
// adv: the adventure this pull belongs to (for the DM log). log:false hands the log entry's data
// back as `entry` instead of writing it, for a caller that folds it into its own entry.
export function pull(name,raw,o={}){raw=aliasRaw(name,raw);name=leverAlias(name);const L=ensureLevers(),def=LEVERS[name],by=o.by,reason=typeof o.reason==='string'?o.reason.trim().slice(0,LK.REASON_MAX):'';
  const fail=why=>{bump(L.stats.rejected,name);bump(L.stats.why,why.split(':')[0].slice(0,40));
    const res={ok:false,reason:why},det={lever:name,by:BY.includes(by)?by:String(by),params:raw&&typeof raw==='object'?JSON.parse(JSON.stringify(raw)):raw,reason,result:'rejected: '+why};
    const sum=['Lever ',gd(name),' refused: '+why+(reason?' (wanted: '+reason+')':'')+'.'];
    if(o.log===false)res.entry={summary:sum,detail:det};else dmlog('lever',o.adv||null,sum,det,{town:o.town,heroes:o.heroes});return res};
  if(!def)return fail('no such lever');
  if(!BY.includes(by))return fail('caller must be scripted, model, agent or dm-agent');
  if(!reason)return fail('a reason is required');
  if(def.stub&&!IMPL[def.stub]&&!def.native)return fail('not available yet');
  const p=validate(def,raw);if(typeof p==='string')return fail(p);
  // The engine's own placements (by 'scripted') never fail on solid ground (#792): the point steps to the nearest open tile.
  // A model or agent caller is refused instead, with that tile named (spotErr), so it can choose.
  if(by==='scripted'&&p.at&&solidAt(p.at.x,p.at.y)){const q=nearestOpen(p.at.x,p.at.y,12);if(q)p.at={x:q.x,y:q.y}}
  const ctx={by,reason,adv:o.adv||null,now:S.gameMin};
  if(def.check){const e=def.check(p,ctx);if(e)return fail(e)}
  const z=def.region?def.region(p):p.region!=null?p.region:null,D=today(),lim=def.limits;
  if(lim.maxActive!=null&&activeOf(name).length>=lim.maxActive)return fail('limit: '+lim.maxActive+' '+name+' already active');
  if(lim.perDay!=null&&(D.n[name]||0)>=lim.perDay)return fail('limit: '+lim.perDay+' '+name+' per game day');
  // Fellowship first (issue #165): with a Fellowship, a share of each daily limit is kept for pulls that concern it,
  // so world upkeep cannot use the day up before the story needs it.
  // Every company a thread (#450): the reserve is kept for a pull that concerns any company (fairness between them: #451).
  const fs=lim.perDay!=null?focuses():[],fo=fs.length?fs:null,forFellow=fo?pullTouchesAny(name,p,z,fs):false;
  if(fo&&!forFellow&&(D.nf[name]||0)>=lim.perDay-reserveOf(lim.perDay))return fail('limit: '+(lim.perDay-reserveOf(lim.perDay))+' '+name+' per game day for the world; the rest is kept for '+(fs.length>1?'the companies':fs[0].company.slots?'the Fellowship':fs[0].company.name||'the company'));
  const fair=fo&&forFellow&&reserveOf(lim.perDay)&&(D.n[name]||0)>=lim.perDay-reserveOf(lim.perDay)?fairRefusal(name,p,z,fs):null;if(fair)return fail('limit: '+fair); // only the reserve is left: a company the DM just served gives way to a starved one (#451)
  if(lim.perRegionPerDay!=null&&z!=null&&(D.rz[name+':'+z]||0)>=lim.perRegionPerDay)return fail('limit: '+lim.perRegionPerDay+' '+name+' per region per game day in '+ZONES[z]);
  const ck=name+(z!=null?':'+z:'');if(def.cooldown&&L.cd[ck]>S.gameMin)return fail('cooldown: '+hrs(L.cd[ck]-S.gameMin)+' left'+(z!=null?' in '+ZONES[z]:''));
  const id=++L.seq;ctx.id=id;ctx.region=z;
  let out;try{out=def.apply(p,ctx)}catch(e){out={ok:false,effect:'failed: '+e.message}}
  if(!out||!out.ok)return fail(out&&out.effect?String(out.effect):'could not be applied');
  bump(D.n,name);if(fo&&!forFellow)bump(D.nf,name);if(z!=null)bump(D.rz,name+':'+z);if(def.cooldown)L.cd[ck]=S.gameMin+def.cooldown;bump(L.stats.pulled,name);
  const until=out.until!=null?Math.round(out.until):null;
  if(until!=null)L.active.push({id,name,params:p,region:z,by,reason,born:S.gameMin,until,undo:out.undo||null,effect:out.effect||null});
  const det={lever:name,id,by,params:shown(def,p),reason,result:'applied',effect:out.effect||null,region:z!=null?ZONES[z]:null,until,lasts:until!=null?hrs(until-S.gameMin):null};
  const sum=['Lever ',gd(name),': '+(def.describe?def.describe(p):name)+(until!=null?' for '+hrs(until-S.gameMin):'')+' - '+reason+'.'];
  const res={ok:true,id,effect:out.effect||null,until,ret:out.ret};
  if(o.log===false)res.entry={summary:sum,detail:det};else dmlog('lever',o.adv||null,sum,det,{town:o.town,heroes:o.heroes});
  return res}
const shown=(def,p)=>{if(!def.hide)return p;const q={...p};for(const k of def.hide)if(k in q)q[k]='(set by the DM)';return q};
// Would a pull of this lever in this region pass its limits and cooldown right now? (No log, no
// validation: the scripted DM asks before it reaches for a lever it has used up.)
export function ready(name,z){const L=ensureLevers(),def=LEVERS[name];if(!def||def.stub&&!IMPL[def.stub])return false;const D=today(),lim=def.limits;
  if(lim.maxActive!=null&&activeOf(name).length>=lim.maxActive)return false;if(lim.perDay!=null&&(D.n[name]||0)>=lim.perDay)return false;
  if(z!=null&&lim.perRegionPerDay!=null&&(D.rz[name+':'+z]||0)>=lim.perRegionPerDay)return false;
  return !(def.cooldown&&L.cd[name+(z!=null?':'+z:'')]>S.gameMin)}
// End an active lever now (retire_npc, withdraw_hook and expiry all come through here).
function end(rec){const L=S.levers,i=L.active.indexOf(rec);if(i>=0)L.active.splice(i,1);const def=LEVERS[rec.name];if(def&&def.expire)def.expire(rec)}
const recOf=id=>S.levers?S.levers.active.find(x=>x.id===id)||null:null;
// Take an active lever back early (issue #636: the DM agent's undo, dismiss and unstage). Only effects that can be removed
// cleanly: a place, an area, a condition, an attitude, a placed person, a special foe not yet in a fight. The lever's own
// expire() does the removal, as when it runs out. Returns {ok, rec} or {ok:false, reason} (the reason says why it stays).
export const TAKE_BACK=['mark_place','mark_dangerous','mark_cleared','set_condition','set_attitude','create_npc','custom_foe'];
export function takeBack(id){const rec=recOf(id);
  if(!rec)return {ok:false,reason:'it is no longer active (it ran out, or was ended already)'};
  if(!TAKE_BACK.includes(rec.name))return {ok:false,reason:rec.name+' cannot be taken back'};
  if(rec.name==='custom_foe'&&(S.mobs||[]).some(m=>m.lever===rec.id&&!m.gone&&m.target))return {ok:false,reason:'the foe is already in a fight'};
  if(rec.name==='create_npc'){const w=(S.wanderers||[]).find(x=>x.lever===rec.id);if(w&&w.staged!=null)return {ok:false,reason:'they belong to a staged scene (unstage it)'}}
  end(rec);return {ok:true,rec}}
// A world-change worth the timeline, at most TL_PER_DAY a game day.
function tl(...parts){const st=S.levers.stats.tl,k='d'+day();if((st[k]||0)>=LK.TL_PER_DAY)return;for(const x in st)if(x!==k)delete st[x];bump(st,k);timeline('world',...parts)}

// ---- lookups the hooks use ----
const inMark=(p,kind)=>{for(const m of S.marks||[])if(m.kind===kind&&dist(p,m)<=m.r)return m;return null};
const condIn=(z,kind)=>{let s=0;for(const c of S.conditions||[])if(c.z===z&&c.kind===kind)s=Math.max(s,c.str);return s};
const anyNpc=id=>(S.npcs||[]).find(x=>x.id===id)||(S.wanderers||[]).find(x=>x.id===id)||null;
const ATT=['hostile','wary','neutral','friendly'],ATT_DC={hostile:3,wary:1,neutral:0,friendly:-2};

// ---- the levers ----
// People
const homeKinds=['town','camp','road'];
register({name:'create_npc',about:'Place a person in the world: a visitor in town, or someone at a camp or on a road.',
  params:{role:{type:'enum',values:WANDER_ROLES.map(x=>x.id)},name:{type:'str',max:24,opt:true},faction:{type:'enum',values:['concord','warband','neutral'],def:'neutral'},
    home:{type:'enum',values:homeKinds},town:{type:'town',opt:true},spot:{type:'enum',values:['inn','smith','quartermaster','chapel','square','gate'],def:'square'},
    at:{type:'point',opt:true},attitude:{type:'enum',values:ATT,def:'neutral'},hours:{type:'int',min:6,max:168,def:48},
    towardParty:{type:'id',opt:true}},
  limits:{maxActive:6,perDay:4,perRegionPerDay:2},cooldown:60,
  region:p=>p.home==='town'?zoneAt(townOf(p.town).gate.x,townOf(p.town).gate.y):p.at?zoneAt(p.at.x,p.at.y):null,
  check(p){if(p.home==='town'){if(!p.town)return 'a town home needs a town';return null}
    if(!p.at)return 'a '+p.home+' home needs a point';return spotErr(p.at,{road:p.home==='road'})},
  apply(p,ctx){ensureNpcs();const R=npcRole(p.role),f=p.faction==='concord'?0:p.faction==='warband'?1:-1;
    const race=f>=0?pickR(RACES.filter(x=>x.fac===f)):pickR(RACES);
    const name=p.name||pickR(race.names[0])+pickR(race.names[1]);
    const c=p.home==='town'?townOf(p.town):null,at=c?(c.spots[p.spot]||c.spots.square):p.at;
    const w={id:++S.uid,kind:'npc',wander:true,role:p.role,title:R.title[f>=0?f:0]||R.title[0],name,race:race.id,fac:f,town:c?c.name:null,home:{x:at.x,y:at.y},post:{x:at.x,y:at.y},
      homeKind:p.home,skin:pickR(race.skin),hair:pickR(race.hair),x:at.x,y:at.y,state:'post',shift:null,face:1,moving:false,chatCd:0,bubble:null,met:{},wait:2,stroll:null,lastBark:'',
      attitude:p.attitude,att:[],lever:ctx.id,z:zoneAt(at.x,at.y)};
    if(p.towardParty!=null)w.att.push({to:'party',id:p.towardParty,a:p.attitude,until:null,lever:ctx.id});
    S.wanderers.push(w);
    return {ok:true,effect:{npc:w.id,name,title:w.title,at:{x:at.x,y:at.y},where:c?c.name:ZONES[w.z]},until:S.gameMin+p.hours*60,ret:w}},
  expire(rec){const i=S.wanderers.findIndex(w=>w.lever===rec.id);if(i>=0)S.wanderers.splice(i,1)},
  describe:p=>(p.attitude!=='neutral'?p.attitude+' ':'')+p.role+(p.name?' '+p.name:'')+(p.home==='town'?' in '+p.town:' at a '+p.home+' in '+(p.at?ZONES[zoneAt(p.at.x,p.at.y)]:'the wilds'))});

register({name:'retire_npc',about:'Send a DM-placed person away (townsfolk keep their posts).',
  params:{npc:{type:'id'}},limits:{perDay:6},
  check(p){const w=(S.wanderers||[]).find(x=>x.id===p.npc);if(!w)return (S.npcs||[]).some(x=>x.id===p.npc)?'townsfolk keep their posts':'no such person';return null},
  apply(p){const w=S.wanderers.find(x=>x.id===p.npc),rec=recOf(w.lever);if(rec)end(rec);else S.wanderers.splice(S.wanderers.indexOf(w),1);
    return {ok:true,effect:{npc:p.npc,name:w.name}}},
  describe:p=>'npc #'+p.npc+' leaves'});

register({name:'set_attitude',about:'How a person feels about a hero, a party or a faction: read by greetings and social checks (hostile +3 DC, wary +1, friendly -2).',
  params:{npc:{type:'id'},to:{type:'enum',values:['hero','party','faction']},id:{type:'int',min:0,max:1e9},attitude:{type:'enum',values:ATT},hours:{type:'int',min:1,max:168,def:24}},
  limits:{maxActive:16,perDay:12},cooldown:0,
  check(p){const n=anyNpc(p.npc);if(!n)return 'no such person';
    if(p.to==='hero'&&!S.agents.some(a=>a.id===p.id&&a.state!=='dead'))return 'no such living hero';
    if(p.to==='party'&&!S.parties.some(x=>x.id===p.id))return 'no such party';
    if(p.to==='faction'&&!(p.id===0||p.id===1))return 'faction must be 0 or 1';return null},
  apply(p,ctx){const n=anyNpc(p.npc),until=S.gameMin+p.hours*60;n.att=(n.att||[]).filter(x=>!(x.to===p.to&&x.id===p.id));
    n.att.push({to:p.to,id:p.id,a:p.attitude,until,lever:ctx.id});return {ok:true,effect:{npc:n.id,name:n.name,toward:p.to+' '+p.id,attitude:p.attitude},until}},
  expire(rec){const n=anyNpc(rec.params.npc);if(n&&n.att)n.att=n.att.filter(x=>x.lever!==rec.id)},
  describe:p=>'npc #'+p.npc+' turns '+p.attitude+' toward '+p.to+' '+p.id});

// Places
const PLACE_KINDS=['ruin','camp','shrine','cairn_door','watchtower'];
const PLACE_NAMES={ruin:['the broken hall','the fallen steading','the roofless chapel'],camp:['the roadside camp','the cold firepit','the drovers’ camp'],
  shrine:['the moss shrine','the lantern cairn','the weeping stone'],cairn_door:['the sealed cairn','the barrow door','the low stone door'],watchtower:['the old watchtower','the burnt tower','the signal post']};
register({name:'mark_place',about:'Put a marker on the map: a ruin, camp, shrine, cairn door or watchtower. Markers sit on walkable ground and never change terrain.',
  params:{kind:{type:'enum',values:PLACE_KINDS},at:{type:'point'},name:{type:'str',max:32,opt:true},hours:{type:'int',min:12,max:336,def:72}},
  limits:{maxActive:10,perDay:4,perRegionPerDay:2},cooldown:60,region:p=>zoneAt(p.at.x,p.at.y),
  check(p){const e=spotErr(p.at);if(e)return e;const q=(S.places||[]).find(x=>dist(x,p.at)<LK.PLACE_GAP);return q?'too close to '+q.name:null},
  apply(p,ctx){const z=zoneAt(p.at.x,p.at.y),name=p.name||pickR(PLACE_NAMES[p.kind])+' of '+ZONES[z];
    const pl={id:++S.uid,kind:p.kind,name,x:p.at.x,y:p.at.y,z,born:S.gameMin,until:S.gameMin+p.hours*60,lever:ctx.id};S.places.push(pl);
    if(p.kind!=='camp')tl(gd(name),' appeared in '+ZONES[z]+'.');
    return {ok:true,effect:{place:pl.id,name,zone:ZONES[z]},until:pl.until,ret:pl}},
  expire(rec){const i=S.places.findIndex(x=>x.lever===rec.id);if(i>=0)S.places.splice(i,1)},
  describe:p=>p.kind.replace('_',' ')+(p.name?' "'+p.name+'"':'')+' in '+ZONES[zoneAt(p.at.x,p.at.y)]});

const markParams={at:{type:'point'},r:{type:'num',min:2,max:6,def:4},lvl:{type:'int',min:1,max:60,opt:true},hours:{type:'int',min:2,max:48,def:24}};
function markCheck(p){const e=spotErr(p.at);if(e)return e;const z=zoneAt(p.at.x,p.at.y);
  if(p.lvl!=null){const b=bandLvl(z,p.lvl);if(b.err)return b.err}return null}
function markApply(kind){return (p,ctx)=>{const z=zoneAt(p.at.x,p.at.y),b=p.lvl!=null?bandLvl(z,p.lvl):{lvl:band(z)[0]+2};
  const m={id:++S.uid,kind,x:p.at.x,y:p.at.y,r:p.r,z,lvl:b.lvl,until:S.gameMin+p.hours*60,lever:ctx.id};
  // a cleared area and a danger area do not overlap: the newer one wins
  S.marks=S.marks.filter(o=>{if(o.kind===kind||dist(o,m)>o.r+m.r*.5)return true;const rec=recOf(o.lever);if(rec){S.levers.active.splice(S.levers.active.indexOf(rec),1);mobsOf(rec.id,true)}return false});
  S.marks.push(m);return {ok:true,effect:{mark:m.id,zone:ZONES[z],lvl:m.lvl,clamped:!!b.clamped,r:m.r},until:m.until}}}
const mobsOf=(lever,despawn)=>{const out=[];for(const m of S.mobs)if(m.lever===lever&&!m.gone){out.push(m);if(despawn&&!m.target){m.alive=false;m.gone=true}else if(despawn)m.lever=null}return out};
register({name:'mark_dangerous',about:'A road segment or area turns dangerous: more road ambushes and a few more monsters of the region (level kept to its band).',
  params:markParams,limits:{maxActive:4,perDay:4,perRegionPerDay:2},cooldown:60,region:p=>zoneAt(p.at.x,p.at.y),check:markCheck,apply:markApply('danger'),
  expire(rec){S.marks=S.marks.filter(m=>m.lever!==rec.id);mobsOf(rec.id,true)},
  describe:p=>'danger around '+Math.round(p.at.x)+','+Math.round(p.at.y)+' in '+ZONES[zoneAt(p.at.x,p.at.y)]});
register({name:'mark_cleared',about:'An area is cleared: road ambushes there turn to quieter encounters and the local monsters move their dens out.',
  params:markParams,limits:{maxActive:4,perDay:6,perRegionPerDay:3},cooldown:30,region:p=>zoneAt(p.at.x,p.at.y),check:markCheck,apply:markApply('cleared'),
  expire(rec){S.marks=S.marks.filter(m=>m.lever!==rec.id)},
  describe:p=>'cleared around '+Math.round(p.at.x)+','+Math.round(p.at.y)+' in '+ZONES[zoneAt(p.at.x,p.at.y)]});

// Local conditions
export const CONDITIONS={
  bandits:  {label:'Bandits',  col:'#c84a3a',about:'more road encounters, more of them ambushes'},
  plague:   {label:'Plague',   col:'#8ab040',about:'townsfolk keep indoors; ambushes turn to lost pilgrims'},
  festival: {label:'Festival', col:'#f2c14e',about:'townsfolk talk more; merchants on the roads instead of ambushes'},
  migration:{label:'Migration',col:'#b08a5a',about:'herds and packs on the move: more monsters across the region'},
  fogbound: {label:'Fog-bound',col:'#9aa8b8',about:'sight shrinks for monsters, duellists and hunters'},
};
register({name:'set_condition',about:'A condition over a whole region for a while: '+Object.entries(CONDITIONS).map(([k,c])=>k+' ('+c.about+')').join('; ')+'.',
  params:{region:{type:'region'},kind:{type:'enum',values:Object.keys(CONDITIONS)},strength:{type:'int',min:1,max:3,def:1},hours:{type:'int',min:3,max:72,def:12}},
  limits:{maxActive:3,perDay:2,perRegionPerDay:1},cooldown:360,
  check(p){return S.conditions.some(c=>c.z===p.region)?ZONES[p.region]+' already has a condition':null},
  apply(p,ctx){const c={id:++S.uid,kind:p.kind,z:p.region,str:p.strength,until:S.gameMin+p.hours*60,lever:ctx.id};S.conditions.push(c);
    tl(CONDITIONS[p.kind].label+' in '+ZONES[p.region]+'.');
    return {ok:true,effect:{condition:c.id,kind:p.kind,zone:ZONES[p.region],strength:p.strength},until:c.until}},
  expire(rec){S.conditions=S.conditions.filter(c=>c.lever!==rec.id);mobsOf(rec.id,true)},
  describe:p=>p.kind+' '+p.strength+' over '+ZONES[p.region]});

// Economy: a shock holds a good's auction-house supply high (prices fall) or low (prices rise).
const SHOCK_SUPPLY={down:[0,20,26,34],up:[0,4,1,0]};
register({name:'price_shock',about:'A good floods the auction house (down) or runs short (up) for a while, through its supply.',
  params:{good:{type:'enum',values:Object.keys(GOODS)},direction:{type:'enum',values:['up','down']},size:{type:'int',min:1,max:3,def:1},hours:{type:'int',min:2,max:24,def:8}},
  limits:{maxActive:2,perDay:3},cooldown:240,
  check(p){return activeOf('price_shock').some(x=>x.params.good===p.good)?p.good+' is already shocked':null},
  apply(p){const g=GOODS[p.good],before=g.supply;shock(p);return {ok:true,effect:{good:p.good,direction:p.direction,supply:[Math.round(before*10)/10,Math.round(g.supply*10)/10]},until:S.gameMin+p.hours*60}},
  describe:p=>p.good+' prices '+p.direction+' ('+p.size+')'});
function shock(p){const g=GOODS[p.good],s=SHOCK_SUPPLY[p.direction][p.size];if(p.direction==='down')g.supply=Math.max(g.supply,s);else g.supply=Math.min(g.supply,s)}

// Hooks, through the DM's hook board (sim/dm.js)
const TPLS=Object.keys(ADVENTURES).filter(k=>k!=='fallen');
const REWARD={small:.8,fair:1,generous:1.25};
register({name:'post_hook',about:'Post a job on a town board: template, giver role, an optional target place or person, and a reward scale (gold only).',
  params:{town:{type:'town'},tpl:{type:'enum',values:[...Object.keys(ADVENTURES),...Object.keys(SUPPLY)]},giver:{type:'enum',values:['captain','innkeeper','smith','quartermaster','priest','bard'],opt:true},
    target:{type:'id',opt:true},region:{type:'region',opt:true},reward:{type:'enum',values:Object.keys(REWARD),def:'fair'},
    src:{type:'enum',values:['request','writ','rumour','oath','follow','remnant','death','dm'],def:'dm'},forHero:{type:'id',opt:true},spec:{type:'obj',opt:true}},
  limits:{perDay:80},cooldown:0,hide:['spec'],
  region:p=>{const c=townOf(p.town);return zoneAt(c.gate.x,c.gate.y)},
  check(p,ctx){if(p.tpl==='fallen'&&ctx.by!=='scripted')return 'only the world posts a recovery for the fallen';
    if(p.spec&&ctx.by!=='scripted')return 'spec is for the scripted DM';
    if(SUPPLY[p.tpl]){const c=townOf(p.town);if(supplyOpenAt(c).length>=SUP.BOARD_MAX)return p.town+'’s board already holds '+SUP.BOARD_MAX+' goods jobs';
      if(p.target!=null)return 'a goods job names no place (leave place out)'}
    const open=(S.adventures||[]).filter(h=>h.phase==='open'&&h.town===p.town).length;if(open>=LK.BOARD_MAX)return p.town+'’s board is full ('+open+')';
    if(p.target!=null&&!(S.places||[]).some(x=>x.id===p.target)&&!anyNpc(p.target))return 'no such place or person';
    if(p.forHero!=null&&!S.agents.some(a=>a.id===p.forHero&&a.state!=='dead'))return 'no such living hero';return null},
  apply(p,ctx){const c=townOf(p.town),o=p.spec?{...p.spec}:{};o.data={...(o.data||{})};if(ctx&&ctx.by)o.by=ctx.by; // the quest log tells the DM agent's jobs apart (sim/questlog.js)
    if(p.giver&&!o.giver)o.roles=[p.giver];if(p.forHero!=null)o.for=p.forHero;if(p.region!=null&&o.zone==null)o.zone=p.region;
    if(p.target!=null){const t=(S.places||[]).find(x=>x.id===p.target)||anyNpc(p.target);o.data.x=t.x;o.data.y=t.y;o.data.place=t.name;if(o.zone==null)o.zone=zoneAt(t.x,t.y)}
    if(SUPPLY[p.tpl]){const j=postSupply(c,p.tpl,{...o,by:ctx&&ctx.by,src:p.src,reward:p.reward,for:p.forHero!=null?p.forHero:o.for});
      return {ok:true,effect:{hook:j.id,tpl:j.tpl,giver:j.giver?j.giver.name:null,zone:'any',wants:j.want.n+' '+j.want.id,pays:j.gold+'g'},ret:j}}
    if(p.reward!=='fair')o.data.payMul=REWARD[p.reward];
    const h=postHook(c,p.tpl,p.src,o);return {ok:true,effect:{hook:h.id,tpl:h.tpl,giver:h.giver?h.giver.name:null,zone:h.zone==null?'any':ZONES[h.zone]},ret:h}},
  describe:p=>p.tpl+' at '+p.town+(p.giver?' from the '+p.giver:'')});
register({name:'withdraw_hook',about:'Take an open job down from a board.',params:{hook:{type:'id'}},limits:{perDay:60},
  check(p){const h=(S.adventures||[]).find(x=>x.id===p.hook)||(S.supply||[]).find(x=>x.id===p.hook);return !h?'no such hook':h.phase!=='open'?'hook #'+p.hook+' is already taken':null},
  apply(p){const h=withdrawHook(p.hook)||withdrawSupply(p.hook);return h?{ok:true,effect:{hook:h.id,tpl:h.tpl,town:h.town}}:{ok:false,effect:'could not take it down'}},
  describe:p=>'hook #'+p.hook+' taken down'});

// Hand a hero an object, or take one back (issue #524; the old give_token / take_token levers are folded in: pull() reads them as
// give_item / take_item with item = token). item: a quest item or token (data/items.js QUEST_ITEMS), a consumable (USES), or a slot
// name (head|chest|hands|feet|main|off|trinket) for one plain piece of gear at lvl (default the hero's own, never above it, never
// an epic: the DM shapes, it does not power up; at most LK.GEAR_PER_DAY a game day). by: a person (npc id) within LK.EAR tiles of
// the hero hands it over; without by it is found where the hero stands. Refused in a fight, with a full pack, for a stranger too far.
// Quest items and tokens carry no numbers and cannot be sold, dropped or given to a companion (sim/inv.js).
const livingHero=id=>{const a=S.agents.find(x=>x.id===id);return a&&a.kind==='hero'&&a.state!=='dead'&&a.state!=='ghost'?a:null};
const FIGHT_STATES=['fight','duel','assist','raid'];
const EPIC_NAMES=new Set([...EPICS.flat(),...BOSS_EPICS,...DG_EPICS]);
const lc=v=>String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
// item text -> {kind:'quest'|'use'|'gear', id} or {err}
function itemOf(text){const t=lc(text);if(!t)return {err:'item is required'};
  const q=Object.keys(QUEST_ITEMS).find(k=>lc(k)===t);if(q)return {kind:'quest',id:q};
  const u=Object.keys(USES).find(k=>lc(k)===t);if(u)return {kind:'use',id:u};
  const g=SLOTS.find(k=>k===t);if(g)return {kind:'gear',id:g};
  if([...EPIC_NAMES].some(n=>lc(n)===t))return {err:'an epic is earned, not handed out'};
  if(Object.keys(GOODS).some(k=>lc(k)===t))return {err:'trade goods are not handed out'};
  return {err:'unknown item "'+String(text).slice(0,40)+'"; a quest item ('+Object.keys(QUEST_ITEMS).join(', ')+'), a consumable ('+Object.keys(USES).slice(0,8).join(', ')+', ...) or a gear slot ('+SLOTS.join('|')+')'}}
const earOf=(a,by)=>{if(by==null)return null;const n=anyNpc(by);return n?{n,near:dist(a,n)<=LK.EAR}:{n:null}};
const personName=n=>(n.title?n.title+' ':'')+n.name;
const withArt=s=>(/^[aeiou]/i.test(s)?'an ':'a ')+s;
function itemCheck(p,give){const a=livingHero(p.hero);if(!a)return 'no such living hero';
  if(FIGHT_STATES.includes(a.state))return a.name+' is in a fight';
  const it=itemOf(p.item);if(it.err)return it.err;
  const e=earOf(a,p.by);if(e){if(!e.n)return 'no such person to hand it over';if(!e.near)return personName(e.n)+' is not within earshot of '+a.name+' (within '+LK.EAR+' tiles)'}
  if(give){
    if(it.kind==='quest'){if(a.inv&&a.inv.list.some(x=>x.kind==='quest'&&x.id===it.id))return a.name+' already carries it';if(room(a)<=0)return a.name+'’s pack is full'}
    else if(it.kind==='use'){if(!count(a,it.id)&&room(a)<=0)return a.name+'’s pack is full'}
    else{if(!a.slots)return a.name+' wears no gear';if(p.ilvl!=null&&p.ilvl>a.lvl)return 'a piece of level '+p.ilvl+' is above '+a.name+'’s level '+a.lvl;
      if((today().n.give_item_gear||0)>=LK.GEAR_PER_DAY)return 'limit: '+LK.GEAR_PER_DAY+' gear piece per game day';if(room(a)<=0)return a.name+'’s pack is full'}}
  else{if(it.kind!=='quest')return it.kind==='gear'?'gear cannot be taken back':'consumables cannot be taken back; only a quest item or a token';
    if(!(a.inv&&a.inv.list.some(x=>x.kind==='quest'&&x.id===it.id)))return a.name+' does not carry it'}
  return null}
const FLAVOUR=it=>it.kind==='quest'?QUEST_ITEMS[it.id].flavour:it.kind==='use'?(USES[it.id].flavour||''):'';
// An object found where the hero stands (a cache a hero searched out, sim/search.js #525): the give_item path without the lever's
// limits. A quest item or consumable by name, or one plain piece of gear for a slot at the hero's level. Returns {name} or {err}.
export function foundItem(a,text){const it=itemOf(text);if(it.err)return {err:it.err};if(room(a)<=0)return {err:'pack full'};let got,name=it.id;
  if(it.kind==='quest'){if(a.inv&&a.inv.list.some(x=>x.kind==='quest'&&x.id===it.id))return {err:'carried'};got=addQuest(a,it.id,null)}else if(it.kind==='use')got=addUse(a,it.id,1);
  else{const g=makeItem(a.cls,it.id,a.lvl,zoneFor(a.lvl),{quality:'plain',src:'Found'});got=addGear(a,g);name=g.name}
  if(!got)return {err:'pack would not take it'};const fl=FLAVOUR(it);notify(a,'Found: '+name+(fl?' '+fl:''),1);record(a,'Found: ',name);return {name}}
register({name:'give_item',allow:['item'],about:'Put one object in a hero’s pack: a quest item or token, a consumable, or one plain piece of gear for a slot (at ilvl, never above the hero’s level, never an epic; '+LK.GEAR_PER_DAY+' a game day). by: a person within earshot hands it over, else it is found where the hero stands. Not in a fight.',
  params:{hero:{type:'id'},item:{type:'str',max:40},by:{type:'id',opt:true},ilvl:{type:'int',min:1,max:60,opt:true}},limits:{perDay:4},cooldown:0,
  check:p=>itemCheck(p,true),
  apply(p){const a=livingHero(p.hero),it=itemOf(p.item),e=earOf(a,p.by),who=e&&e.n?personName(e.n):null;let name=it.id,got;
    if(it.kind==='quest')got=addQuest(a,it.id,null);else if(it.kind==='use')got=addUse(a,it.id,1);
    else{const lvl=p.ilvl!=null?p.ilvl:a.lvl,g=makeItem(a.cls,it.id,lvl,zoneFor(lvl),{quality:'plain',src:who?'Given by '+who:'Found'});got=addGear(a,g);name=g.name;bump(today().n,'give_item_gear')}
    if(!got)return {ok:false,effect:'the pack would not take it'};
    const fl=FLAVOUR(it),line=(who?who+' presses '+withArt(name)+' into your hand.':'Half-buried in the dirt where you stand: '+name+'.')+(fl?' '+fl:'');
    {const sc=sceneOf(a);if(sc){sc.given=name;takeProp(sc,name)}} // a scene prop the speaker held is now the hero's (render: sceneItem)
    notify(a,line,1);record(a,'Given: ',name+(who?' (from '+who+')':' (found)'));
    return {ok:true,effect:{hero:a.name,item:name,kind:it.kind,by:who||'found'}}},
  describe:p=>p.item+' to hero #'+p.hero});
register({name:'take_item',allow:['item'],about:'Take a quest item or token out of a hero’s pack (a toll paid, a key surrendered); by: a person within earshot takes it. Refused for gear and consumables, and in a fight.',
  params:{hero:{type:'id'},item:{type:'str',max:40},by:{type:'id',opt:true}},limits:{perDay:4},cooldown:0,
  check:p=>itemCheck(p,false),
  apply(p){const a=livingHero(p.hero),it=itemOf(p.item),e=earOf(a,p.by),who=e&&e.n?personName(e.n):null;take(a,'quest',it.id,1);
    notify(a,who?who+' takes the '+it.id+' from you.':'You leave the '+it.id+' behind.',1);record(a,'Gave up: ',it.id+(who?' (to '+who+')':''));
    return {ok:true,effect:{hero:a.name,item:it.id,by:who||'left behind'}}},
  describe:p=>p.item+' taken from hero #'+p.hero});
// the old token levers, folded in
const ALIAS={give_token:'give_item',take_token:'take_item'};
export const leverAlias=name=>ALIAS[name]||name;
const aliasRaw=(name,raw)=>{if(!ALIAS[name]||!raw||typeof raw!=='object')return raw;const q={...raw};if('token' in q){q.item=q.token;delete q.token}return q};
export const aliasParams=aliasRaw;

// Foes for an adventure scene: one monster of the region raised to a named foe, its level kept
// to the region's band. The adventure owns it (dm.js places it and tags it m.adv).
register({name:'named_foe',about:'Raise a named foe for a running adventure: a monster of the region, level clamped to the band.',
  params:{type:{type:'enum',values:Object.keys(MOBS)},region:{type:'region'},lvl:{type:'int',min:1,max:60},name:{type:'str',max:24},title:{type:'str',max:60,def:''},solo:{type:'bool',def:false}},
  limits:{perDay:60},cooldown:0,
  check(p,ctx){if(!ctx.adv||ctx.adv.phase!=='active')return 'a named foe belongs to a running adventure';return bandLvl(p.region,p.lvl).err||null},
  // the species' bestiary block as a leader (hp and bite scaled to the old BEAST.scale / hit), with its name's signature ability
  apply(p){const b=bandLvl(p.region,p.lvl),m=spawnMob(p.type),k=p.solo?0:1,B=blockOf(p.type);
    m.role='leader';m.lvl=b.lvl;m.maxhp=Math.round((25+m.lvl*16)*BEAST.scale[k]);m.hp=m.maxhp;m.hpl=m.hp;
    m.hit=blockOf(p.type,undefined,'leader').hit*BEAST.hit[k];m.acd=ROLES.leader.cd;
    m.ab=[...new Set([...B.abilities,...(NAMED_KITS[p.name]||[])])].slice(0,3);m.abcd={};m.name=p.name;m.title=p.title;m.named=true;
    return {ok:true,effect:{mob:m.id,lvl:m.lvl,clamped:b.clamped,type:p.type},ret:m}},
  describe:p=>p.name+' (L'+p.lvl+' '+p.type+')'});

// A special foe from the bestiary (sim/encounterbuilder.js customFoe): a creature with a few tweaks
// (+levels, one ability swapped, one resistance, a name) inside the bestiary's tweak budget and
// its per-region daily cap, placed on a walkable spot of the region, level kept to the band.
// swap and resist: {pair:[old,new]} / {pair:[tag,mult]}. It wanders off after a game day.
register({name:'custom_foe',about:'A special foe from the bestiary: base creature, +0-'+CUSTOM.maxLevels+' levels, an ability swap, a resistance and a name, within '+CUSTOM.points+' tweak points; '+CUSTOM.perRegionDay+' per region per game day.',
  params:{base:{type:'str',max:40},region:{type:'region'},at:{type:'point'},lvl:{type:'int',min:1,max:60,opt:true},name:{type:'str',max:40,opt:true},
    levels:{type:'int',min:0,max:CUSTOM.maxLevels,def:0},swap:{type:'obj',opt:true},resist:{type:'obj',opt:true}},
  limits:{maxActive:6,perDay:CUSTOM.perRegionDay*ZONES.length,perRegionPerDay:CUSTOM.perRegionDay},cooldown:30,
  check(p){const e=spotErr(p.at,{region:p.region});if(e)return e;if(p.lvl!=null)return bandLvl(p.region,p.lvl).err||null;return null},
  apply(p,ctx){const lvl=p.lvl!=null?bandLvl(p.region,p.lvl).lvl:band(p.region)[0]+2,pair=v=>v&&Array.isArray(v.pair)&&v.pair.length===2?v.pair:undefined;
    const f=customFoe(p.base,{name:p.name,levels:p.levels,swap:pair(p.swap),resist:pair(p.resist)},{region:p.region,level:lvl,reason:ctx.reason,adv:ctx.adv});
    if(!f){const e=S.dmLog&&S.dmLog[0];return {ok:false,effect:e&&e.kind==='custom'?String(e.summary[0]).replace('Special foe refused: ',''):'the bestiary refused it'}}
    const m=spawnFoe(f);m.hpl=m.hp;m.x=p.at.x;m.y=p.at.y;m.home={...p.at};m.spawn={...p.at};m.lever=ctx.id;if(ctx.adv)m.adv=ctx.adv.id;
    return {ok:true,effect:{mob:m.id,name:f.name,lvl:m.lvl,points:f.points},until:S.gameMin+DAY,ret:m}},
  expire(rec){mobsOf(rec.id,true)},
  describe:p=>(p.name||p.base)+' in '+ZONES[p.region]});
// Stubs: they reject with "not available yet" until the system behind them registers an
// implementation (provide('createSite', fn) once #69 gives sites a lifecycle, startEvent, nudgeRelation),
// or replaces the lever outright with register().
// create_site (#69, slice 1): sim/sites.js provides the generator and owns the site's lifecycle (it is not an expiring lever:
// a site stays until cleared or collapsed, so the open-site caps, 1 a region and 3 a world, are checked there).
register({name:'create_site',stub:'createSite',about:'Raise a dungeon site a company can enter: a '+SITE_THEME_IDS.join(', ')+' in a region, its level clamped to the region’s band (band: the level wanted), 3-8 rooms, a named boss with a guaranteed epic. raid: true makes it a raid site (5 or more heroes, a boss that fights in phases, locked for 2 days after each kill). At most 1 open site a region and 3 in the world.',
  params:{theme:{type:'enum',values:SITE_THEME_IDS},region:{type:'region'},band:{type:'int',min:1,max:60,opt:true},rooms:{type:'int',min:3,max:8,opt:true},at:{type:'point',opt:true},name:{type:'str',max:40,opt:true},raid:{type:'bool',opt:true}},
  limits:{perDay:2,perRegionPerDay:1},cooldown:120,apply:(p,ctx)=>IMPL.createSite(p,ctx),describe:p=>(p.raid?'raid ':'')+p.theme+(p.name?' "'+p.name+'"':'')+' in '+ZONES[p.region]+(p.band!=null?' (level '+p.band+')':'')});
register({name:'start_event',stub:'startEvent',about:'A world event (#10).',params:{kind:{type:'str',max:24},region:{type:'region'},scale:{type:'int',min:1,max:3,def:1}},
  limits:{maxActive:1,perDay:1},cooldown:1440,apply:(p,ctx)=>IMPL.startEvent(p,ctx),expire(rec){if(IMPL.endEvent)IMPL.endEvent(rec);S.conditions=(S.conditions||[]).filter(c=>c.lever!==rec.id)},describe:p=>p.kind+' in '+ZONES[p.region]});
register({name:'nudge_relation',stub:'nudgeRelation',about:'Shift how two parties of the world regard each other (#11).',params:{a:{type:'str',max:24},b:{type:'str',max:24},delta:{type:'int',min:-2,max:2}},
  limits:{perDay:2},cooldown:720,apply:(p,ctx)=>IMPL.nudgeRelation(p,ctx),describe:p=>p.a+' / '+p.b+' '+(p.delta>0?'+':'')+p.delta});

// ---- hooks the world reads ----
export function encRate(){let k=1;for(const m of S.marks||[])if(m.kind==='danger')k+=.25;
  for(const c of S.conditions||[]){if(c.kind==='bandits')k+=.2*c.str;else if(c.kind==='festival')k+=.1*c.str}return k}
// The kind of encounter that appears at road spot p (the table's pick passed in).
export function encKind(p,kind,rnd){const z=zoneAt(p.x,p.y),d=inMark(p,'danger'),bs=condIn(z,'bandits');
  if((d||bs)&&kind!=='ambush'&&rnd()<(d?.5:0)+.15*bs)return 'ambush';
  if(kind==='ambush'){if(inMark(p,'cleared'))return 'shrine';if(condIn(z,'festival'))return 'merchant';if(condIn(z,'plague'))return 'pilgrim'}
  return kind}
// One road spot inside a danger area, for half the spawns while one is marked; null otherwise.
export function encSpot(spots,rnd){const D=(S.marks||[]).filter(m=>m.kind==='danger');if(!D.length||rnd()<.5)return null;
  const m=D[Math.floor(rnd()*D.length)],in_=spots.filter(s=>dist(s,m)<=m.r);return in_.length?in_[Math.floor(rnd()*in_.length)]:null}
export const sightLever=z=>{const s=condIn(z,'fogbound');return s?Math.max(.5,1-.15*s):1};
export function presence(town){const c=townOf(town);if(!c)return 1;const z=zoneAt(c.gate.x,c.gate.y);
  const f=condIn(z,'festival'),pl=condIn(z,'plague');return (f?1+.5*f:1)*(pl?Math.max(.2,1-.3*pl):1)}
// How an NPC regards these heroes: the worst of what it feels toward any of them, their party or
// faction, else its own default (a DM-placed person's attitude), else neutral.
export function attitudeOf(p,heroes){if(!p)return 'neutral';let worst=null;
  for(const x of p.att||[]){if(x.until!=null&&S.gameMin>=x.until)continue;
    if(!heroes.some(a=>x.to==='hero'?a.id===x.id:x.to==='party'?a.party&&a.party.id===x.id:a.fac===x.id))continue;
    if(worst==null||ATT.indexOf(x.a)<ATT.indexOf(worst))worst=x.a}
  return worst||p.attitude||'neutral'}
// The DC change for a social roll at `at`: the adventure's giver (by name) and any DM-placed person
// within 6 tiles. Returns {dc, who, attitude} (dc 0 when nobody there feels anything).
export function attitudeDc(giverName,at,heroes){let best={dc:0,who:null,attitude:'neutral'};
  const look=p=>{const a=attitudeOf(p,heroes),dc=ATT_DC[a];if(Math.abs(dc)>Math.abs(best.dc)||(Math.abs(dc)===Math.abs(best.dc)&&dc>best.dc))best={dc,who:p.title+' '+p.name,attitude:a}};
  if(giverName)for(const p of S.npcs||[])if(giverName===p.title+' '+p.name)look(p);
  if(at)for(const p of S.wanderers||[])if(dist(p,at)<6)look(p);
  return best}

// ---- once per step (sim/index.js) ----
export function leverTick(dt){const L=ensureLevers();
  for(let i=L.active.length-1;i>=0;i--){const rec=L.active[i];if(rec&&S.gameMin>=rec.until)end(rec)}
  for(const rec of L.active)if(rec.name==='price_shock')shock(rec.params);
  for(const w of S.wanderers)wander(w,dt);
  L.ecoT-=dt;if(L.ecoT<=0){L.ecoT=LK.ECO_T;ecology()}}

// DM-placed people: a short stroll around home, a greeting for heroes who come close, cold words
// from a hostile one. Lines come from data/npcs.js (WANDER_ROLES) through npcSay.
function wander(w,dt){if(w.chatCd>0)w.chatCd-=dt;if(w.bubble){w.bubble.life-=dt;if(w.bubble.life<=0)w.bubble=null}
  if(w.stroll){if(moveTo(w,w.stroll.x,w.stroll.y,dt,1)){w.stroll=null;w.wait=4+r()*8}}
  else{w.moving=false;w.wait-=dt;if(w.wait<=0){const a=r()*6.283,d=r()*1.4,q={x:w.home.x+Math.cos(a)*d,y:w.home.y+Math.sin(a)*d};
    if(!spotErr(q,{clear:.1})||w.homeKind==='town')w.stroll=q;else w.wait=3}}
  if(w.chatCd>0)return;
  for(const a of S.agents){if(a.state==='dead'||a.state==='ghost'||a.hidden||dist(a,w)>2.2)continue;
    const last=w.met[a.id];if(last!=null&&S.gameMin-last<DAY)continue;w.met[a.id]=S.gameMin;
    const att=attitudeOf(w,[a]);if(r()>(att==='hostile'?.6:.35)*presence(w.town))continue;
    w.face=a.x>w.x?1:-1;npcSay(w,att==='hostile'?'hostile':att==='wary'?'wary':'greet',{target:a.name});return}}

// Danger areas keep a couple of the region's monsters at hand; migrations add some across the
// region; cleared areas push local dens out past their edge. Lever monsters vanish with the lever.
function ecology(){
  for(const m of S.marks){const rec=recOf(m.lever);if(!rec)continue;
    if(m.kind==='danger'){const have=mobsOf(m.lever).filter(x=>x.alive).length;
      if(have<LK.DANGER_MOBS){const t=typeFor(m.z,m.lvl);if(t){const x=spawnMob(t),p=spotNear(m);if(p){x.x=x.home.x=x.spawn.x=p.x;x.y=x.home.y=x.spawn.y=p.y;x.home={...p};x.spawn={...p}}
        x.lvl=clamp(m.lvl+Math.floor(r()*3)-1,band(m.z)[0],bandHi(m.z)+2);x.maxhp=25+x.lvl*16;x.hp=x.maxhp;x.lever=m.lever}}}
    else for(const x of S.mobs){if(!x.alive||x.gone||x.elite||x.named||x.adv!=null||x.lever!=null||MOBS[x.type].z!==m.z)continue;
      const d=dist(x.home,m);if(d>=m.r)continue;const k=(m.r+1)/Math.max(.1,d),q={x:m.x+(x.home.x-m.x)*k,y:m.y+(x.home.y-m.y)*k};
      if(d<.1||spotErr(q,{clear:.1})||zoneAt(q.x,q.y)!==m.z)continue;x.home={...q};x.spawn={...q};if(!x.target)x.dest={...q}}}
  for(const c of S.conditions){if(c.kind!=='migration')continue;const have=mobsOf(c.lever).filter(x=>x.alive).length;
    if(have<LK.MIGRATE_MOBS*c.str){const t=typeFor(c.z,band(c.z)[0]+2);if(t){const x=spawnMob(t);x.lever=c.lever}}}}
function typeFor(z,lvl){const ts=Object.keys(MOBS).filter(k=>MOBS[k].z===z);if(!ts.length)return null;const near=ts.filter(k=>MOBS[k].lv[0]<=lvl+1);return pickR(near.length?near:ts)}
function spotNear(m){for(let i=0;i<8;i++){const a=r()*6.283,d=r()*m.r,q={x:m.x+Math.cos(a)*d,y:m.y+Math.sin(a)*d};if(!spotErr(q,{clear:.1})&&zoneAt(q.x,q.y)===m.z)return q}return null}

// ---- for the UI ----
export const leverRec=id=>recOf(id);
export const conditionAt=z=>(S.conditions||[]).find(c=>c.z===z)||null;
