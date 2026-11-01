// The encounter builder (issue #84): fills fights and whole sites from the bestiary so the DM never
// designs a monster. Owned by creature-designer. Data lives in data/encounter-tables.js and
// data/bestiary.js; this file is the logic.
//   buildEncounter(theme, region, partyLevel, partySize, opt) -> {theme, region, budget, spent, foes[]}
//   buildSite(theme, band, size, opt)                          -> {theme, rooms[]} (guard, trap, puzzle, treasure, shrine, boss)
//   customFoe(baseId, tweaks, ctx)                             -> a special foe, or null when over budget / capped
//   spawnFoe(foe)                                              -> a live mob from a foe description
// All randomness goes through opt.rng (default Math.random via core/rng), so a seeded rng makes both
// builders deterministic. Wired now: DM fight scenes (sim/dm.js) use buildEncounter. Road ambushes in
// sim/encounters.js stay dice rolls, not mobs. #65 (crawls) and #69 (DM dungeons) call buildSite.
import {rnd} from '../core/rng.js';
import {MOBS} from '../data/mobs.js';
import {EPICS,DG_EPICS} from '../data/items.js';
import {blockOf,VARIANTS,ABILITIES,TAGS} from '../data/bestiary.js';
import {PER_HEAD,LEVEL_STEP,MAX_FOES,ROOM_BUDGET,DIFFICULTY,THEMES,TRAPS,PUZZLES,SHRINES,SITE_BOSSES,ROOM_LOOT,CUSTOM} from '../data/encounter-tables.js';
import {zoneFor,ZONES} from '../world/map.js';
import {S} from './state.js';
import {spawnMob} from './mobs.js';
import {dmlog} from './dmlog.js';

const GOLD_K=4;
const mk=rng=>({ri:(a,b)=>a+Math.floor(rng()*(b-a+1)),pick:a=>a[Math.floor(rng()*a.length)],f:(a,b)=>a+rng()*(b-a)});
const wpick=(items,w,rng)=>{let t=0;for(const x of items)t+=w(x);let r=rng()*t;for(const x of items){r-=w(x);if(r<=0)return x}return items[items.length-1]};

// ---- budget ----
export const budgetFor=(partyLevel,partySize,difficulty='normal')=>partySize*PER_HEAD*(DIFFICULTY[difficulty]||1);
export const costOf=(foe,partyLevel)=>blockOf(foe.type,foe.variant,foe.roleOv).cost*Math.pow(LEVEL_STEP,foe.lvl-partyLevel);

// ---- pools ----
// Candidates for a theme and region at a level: the region's field species (always) and the site foes of the theme.
// Each is {type, variant, name, family, role, lv, w}. type is the MOBS key it is spawned (and drawn) as.
export function poolFor(theme,region,level,opt={}){const th=THEMES[theme]||THEMES.den,out=[];
  const fieldKeys=Object.keys(MOBS).filter(k=>MOBS[k].z===region);
  const keys=fieldKeys.length?fieldKeys:Object.keys(MOBS);
  for(const k of keys){const M=MOBS[k],B=blockOf(k),fit=M.lv[0]<=level+1&&M.lv[1]>=level-4?1:.08;
    out.push({type:k,variant:null,name:M.name,pl:M.pl,family:B.family,role:B.role,lv:M.lv,w:(th.fam[B.family]||.4)*fit})}
  if(th.variants&&opt.variants!==false){
    for(const v in VARIANTS){const V=VARIANTS[v];if(!V.themes.includes(theme)||level<V.lv[0]-1||level>V.lv[1]+2)continue;
      const base=keys.find(k=>k.split('@')[0]===V.base)||keys[0];
      out.push({type:base,variant:v,name:V.name,pl:V.pl,family:V.family,role:V.role,lv:V.lv,w:(th.fam[V.family]||.4)*1.4})}}
  return out}

// ---- encounters ----
// opt: rng, difficulty ('easy'|'normal'|'hard'), n:[min,max] foes (budget decides inside), lvlBand:[lo,hi] levels foes
// are clamped to (default partyLevel-1..+1), mono (one species only), variants (false: field species only),
// budgetMul, roles (restrict to these roles).
export function buildEncounter(theme,region,partyLevel,partySize,opt={}){
  const rng=opt.rng||rnd,R=mk(rng),th=THEMES[theme]||THEMES.den,budget=budgetFor(partyLevel,partySize,opt.difficulty)*(opt.budgetMul||1);
  let pool=poolFor(theme,region,partyLevel,opt);if(opt.roles)pool=pool.filter(c=>opt.roles.includes(c.role));
  const [nmin,nmax]=opt.n||[1,MAX_FOES],band=opt.lvlBand||[Math.max(1,partyLevel-1),partyLevel+1],foes=[];let spent=0;
  if(!pool.length||nmax<=0)return {theme,region,budget,spent,foes};
  const primary=wpick(pool,c=>c.w,rng);
  while(foes.length<nmax){
    const c=opt.mono||rng()<.7||pool.length===1?primary:wpick(pool,x=>x.w,rng);
    const lvl=Math.max(1,Math.min(band[1],Math.max(band[0],R.ri(c.lv[0],c.lv[1]))));
    const f={type:c.type,variant:c.variant,lvl,name:c.name,family:c.family,role:c.role};f.cost=Math.round(costOf(f,partyLevel)*100)/100;
    if(foes.length>=nmin&&spent+f.cost>budget+.15)break; // a little tolerance: a four-hero party can meet five weak foes
    foes.push(f);spent+=f.cost;if(foes.length>=nmin&&spent>=budget)break}
  foes.forEach(f=>f.abilities=blockOf(f.type,f.variant,f.roleOv).abilities.slice());
  return {theme,region,budget:Math.round(budget*100)/100,spent:Math.round(spent*100)/100,foes}}

// A live mob from a foe description (positions are the caller's business). Bosses and special foes carry their
// own multipliers on the description.
export function spawnFoe(f){return spawnMob(f.type,null,{lvl:f.lvl,variant:f.variant||undefined,role:f.roleOv,abilities:f.abilities&&f.abilities.slice(),
  hpMul:f.hpMul,hitMul:f.hitMul,name:f.variant||f.special||f.boss?f.name:undefined,title:f.title,special:f.special,res:f.res,weak:f.weak})}

// ---- sites ----
// Room kinds for a site of `size` rooms: the plan's first room and boss are kept, the middle trimmed or extended.
function planFor(th,size,R){const base=th.plan.slice(),mid=base.slice(1,-1);size=Math.max(3,Math.min(9,size|0));
  const want=size-2;let m=mid.slice();
  while(m.length>want)m.splice(Math.floor(m.length/2),1);
  while(m.length<want)m.splice(R.ri(1,m.length),0,R.pick(['guard','guard','treasure','trap']));
  return [base[0],...m,base[base.length-1]]}
const goodsOf=(region,R,n)=>{const g=[];const keys=Object.keys(MOBS).filter(k=>MOBS[k].z===region);const names=[...new Set(keys.map(k=>MOBS[k].loot))];
  for(let i=0;i<n&&names.length;i++)g.push(R.pick(names));return g};

function lootFor(kind,level,region,theme,R,rng){const L=ROOM_LOOT[kind],gold=Math.round(level*R.f(L.gold[0],L.gold[1])*GOLD_K),
  loot={gold,goods:goodsOf(region,R,R.ri(L.goods[0],L.goods[1]))};
  if(rng()<L.gear.chance)loot.gear={ilvl:level+L.gear.lead,quality:L.gear.quality};
  if(kind==='boss'){const table=theme==='crypt'?DG_EPICS:(EPICS[region]||EPICS[0]);loot.epic=R.pick(table);loot.epicChance=.6}
  return loot}

// band: [lowest, highest] party level the site is for. size: number of rooms (3-9). opt: rng, partySize (default 4),
// difficulty, region (default: the region of each room's level), name.
export function buildSite(theme,band,size,opt={}){
  const rng=opt.rng||rnd,R=mk(rng),th=THEMES[theme]||THEMES.den,party=opt.partySize||4,kinds=planFor(th,size,R),n=kinds.length,rooms=[];
  kinds.forEach((kind,i)=>{
    const level=Math.round(band[0]+(band[1]-band[0])*(n>1?i/(n-1):0)),region=opt.region!=null?opt.region:zoneFor(band[0]),room={i,kind,level,region,foes:[],loot:null};
    if(kind==='guard'||kind==='treasure'){
      const E=buildEncounter(theme,region,level,party,{rng,difficulty:opt.difficulty,budgetMul:ROOM_BUDGET[kind],n:[kind==='guard'?1:0,kind==='guard'?MAX_FOES:3],lvlBand:[Math.max(1,level-1),level+1]});
      room.foes=E.foes;room.budget=E.budget}
    else if(kind==='trap'){const t=R.pick(TRAPS);room.hazard={...t,dc:8+Math.ceil(level/2)}}
    else if(kind==='puzzle'){const p=R.pick(PUZZLES);room.hazard={...p,dc:9+Math.ceil(level/2)}}
    else if(kind==='shrine'){room.hazard={...R.pick(SHRINES)}}
    else if(kind==='boss'){
      const tab=SITE_BOSSES[theme]||SITE_BOSSES.den,top=band[1],pick=tab.filter(b=>b.from<=top).pop()||tab[0],V=VARIANTS[pick.variant],lvl=Math.max(band[1],level)+1;
      const base=Object.keys(MOBS).find(k=>MOBS[k].z===region&&k.split('@')[0]===V.base)||Object.keys(MOBS).find(k=>MOBS[k].z===region)||Object.keys(MOBS)[0];
      const guards=buildEncounter(theme,region,level,party,{rng,difficulty:opt.difficulty,budgetMul:ROOM_BUDGET.boss,n:[0,3],lvlBand:[Math.max(1,level-1),level]});
      const boss={type:base,variant:pick.variant,roleOv:'leader',lvl,name:pick.name,title:pick.title,family:V.family,role:'leader',boss:true,hpMul:1.9,hitMul:1.2};
      boss.cost=Math.round(costOf(boss,level)*100)/100;boss.abilities=blockOf(base,pick.variant,'leader').abilities.slice();
      room.foes=[boss,...guards.foes];room.budget=Math.round(boss.cost*100)/100}
    room.loot=lootFor(kind,level,region,theme,R,rng);
    rooms.push(room)});
  return {theme,label:th.label,name:opt.name||null,band:band.slice(),partySize:party,rooms}}

// ---- special foes ----
// A custom foe is a bestiary creature with a few tweaks, flagged special. Tweak points: +1 or +2 levels cost 1 each,
// swapping one ability 1, adding a resistance 1, renaming 0; at most CUSTOM.points in all. At most CUSTOM.perRegionDay
// per region per game-day, whatever the DM wants. Every grant and every refusal goes to the DM log.
// tweaks: {name, levels, swap:[oldId,newId], resist:[tag,mult]}; ctx: {region, level, reason, adv}.
export function customFoe(baseId,tweaks,ctx={}){const t=tweaks||{},M=MOBS[baseId],V=VARIANTS[baseId];
  const refuse=why=>{dmlog('custom',ctx.adv||null,['Special foe refused: '+why],{base:baseId,tweaks:t,reason:ctx.reason||'',granted:false});return null};
  if(!M&&!V)return refuse('no such creature '+baseId);
  const type=M?baseId:Object.keys(MOBS).find(k=>k.split('@')[0]===V.base&&(ctx.region==null||MOBS[k].z===ctx.region))||Object.keys(MOBS).find(k=>k.split('@')[0]===V.base);
  if(!type)return refuse('no body for '+baseId);
  const region=ctx.region!=null?ctx.region:MOBS[type].z,levels=Math.max(0,t.levels|0);if(levels>CUSTOM.maxLevels)return refuse('at most +'+CUSTOM.maxLevels+' levels');
  let pts=levels*CUSTOM.costs.level;const B=blockOf(type,M?undefined:baseId),abil=B.abilities.slice();
  if(t.swap){const [o,n]=t.swap;if(!ABILITIES[n])return refuse('unknown ability '+n);const i=abil.indexOf(o);if(i<0)return refuse(baseId+' has no '+o);abil[i]=n;pts+=CUSTOM.costs.swap}
  let res=null;if(t.resist){const [tag,mul]=t.resist;if(!TAGS.includes(tag))return refuse('unknown tag '+tag);res={...B.res,[tag]:Math.max(.7,Math.min(1,+mul||.85))};pts+=CUSTOM.costs.resist}
  if(pts>CUSTOM.points)return refuse('over the tweak budget ('+pts+' > '+CUSTOM.points+')');
  const day=Math.floor(S.gameMin/1440),C=S.customFoes&&S.customFoes.day===day?S.customFoes:(S.customFoes={day,byRegion:{}});
  if((C.byRegion[region]||0)>=CUSTOM.perRegionDay)return refuse('region '+(ZONES[region]||region)+' already has '+CUSTOM.perRegionDay+' special foes today');
  C.byRegion[region]=(C.byRegion[region]||0)+1;
  const lvl=Math.min(24,(ctx.level!=null?ctx.level:(M?M:{lv:V.lv}).lv[0])+levels),name=String(t.name||('Marked '+(M?M.name:V.name))).slice(0,40);
  const foe={type,variant:M?null:baseId,lvl,name,family:B.family,role:B.role,special:true,abilities:abil,res:res||undefined,hpMul:1+.1*levels,tweaks:{levels,swap:t.swap||null,resist:t.resist||null},points:pts};
  foe.cost=Math.round(costOf(foe,ctx.level!=null?ctx.level:lvl)*100)/100;
  dmlog('custom',ctx.adv||null,['Special foe: '+name+' ('+(M?M.name:V.name)+', level '+lvl+', '+pts+' tweak points) in '+(ZONES[region]||region)+(ctx.reason?' - '+ctx.reason:'')],{base:baseId,tweaks:foe.tweaks,points:pts,region,reason:ctx.reason||'',granted:true,today:C.byRegion[region]},{heroes:ctx.adv?undefined:[]});
  return foe}
