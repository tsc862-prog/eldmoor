// Slot equipment: seven named, levelled items per hero replace the old single gear number.
// Drops (rollDrop), town upgrades (shopUpgrade), epic placement (equipEpic) and the derived
// gearScore that maxHp/atkOf read. Owned by creature-designer.
import {rnd,ri,clamp,pickA} from '../core/rng.js';
import {SLOTS,GEAR_MATERIALS,SLOT_NOUNS,EPIC_SLOT,epicZone,STAT_KEYS,STAT_RATE,STAT_CAP,BUDGET_K,SLOT_WEIGHT,SLOT_LEAN,CLASS_SHARE,QUALITY,rollQuality,AFFIXES,EPIC_STATS} from '../data/items.js';
import {homeOf} from '../data/races.js';
import {MOBS} from '../data/mobs.js';
import {tm} from '../data/traits.js';
import {zoneFor} from '../world/map.js';
import {log} from './chronicle.js';

// Tuning. gearScore = average item level over the seven slots * GEAR_K. Heroes keep their slots
// near their own level (shop items are ilvl = level, drops are mob level +-1), so without the factor
// the score would sit at about 0.9 x level; the old gear number, throttled by gold, sat at about
// 0.55-0.65 x level in 60-120 minute runs. GEAR_K keeps maxHp/atkOf where they were.
export const GEAR_K=.65;
export const DROP_RATE=.06;            // slot item per ordinary kill; named elites always drop one
export const SHOP_COST=ilvl=>6*ilvl;   // gold for a town-bought item
export const SELL_VALUE=it=>it.ilvl*2; // gold the auction house pays for a replaced or unwanted item

export function emptySlots(){const s={};for(const k of SLOTS)s[k]=null;return s}
export function gearScore(a){if(!a.slots)return a.gear||0;let t=0;for(const k of SLOTS){const it=a.slots[k];if(it)t+=it.ilvl}return t/SLOTS.length*GEAR_K}
export const syncGear=a=>{a.gear=Math.round(gearScore(a));a.gtot=statTotals(a)};
export const slotLevel=(a,k)=>a.slots[k]?a.slots[k].ilvl:0;

// ---- stats (issue #52) ----
// Roll an item's stats: a budget of ilvl * BUDGET_K * slot weight * quality, split over the three
// (four on a rare) stats its class, slot and affixes favour. Affixes pull their own stat up.
function rollStats(cls,slot,ilvl,zone,quality){
  const budget=ilvl*BUDGET_K*(SLOT_WEIGHT[slot]||1)*QUALITY[quality].mult,sh=CLASS_SHARE[cls]||CLASS_SHARE.Warrior,lean=SLOT_LEAN[slot]||{};
  const pool=(AFFIXES[zone]||AFFIXES[0]).slice(),aff=[];
  for(let i=0;i<QUALITY[quality].affixes&&pool.length;i++)aff.push(pool.splice(ri(0,pool.length-1),1)[0]);
  const w={};for(const k of STAT_KEYS)w[k]=sh[k]*(lean[k]||1)*(.7+rnd()*.6);
  for(const [,k] of aff)w[k]*=2.2;
  const top=STAT_KEYS.slice().sort((x,y)=>w[y]-w[x]).slice(0,quality==='rare'?4:3),sum=top.reduce((t,k)=>t+w[k],0),stats={};
  for(const k of top)stats[k]=Math.max(1,Math.round(budget*w[k]/sum));
  return {stats,affixes:aff.map(x=>x[0])}}
// Stats of an epic at its current level: fixed ratios times ilvl.
export function epicStats(name,ilvl){const E=EPIC_STATS[name],s={};if(!E)return s;for(const k in E.r)s[k]=Math.max(1,Math.round(ilvl*E.r[k]));return s}
// The stats of any item. Items from older saves have none stored, so derive an ordinary spread.
export function itemStats(it){if(!it)return {};if(it.stats)return it.stats;if(it.epic&&EPIC_STATS[it.name])return epicStats(it.name,it.ilvl);
  const b=it.ilvl*BUDGET_K*(SLOT_WEIGHT[it.slot]||1),s={};s.vigor=Math.round(b*.4);s.might=Math.round(b*.35);s.guard=Math.round(b*.1);s.precision=Math.round(b*.05);s.haste=Math.round(b*.1);return s}
function statTotals(a){const t={vigor:0,might:0,guard:0,precision:0,haste:0};if(!a.slots)return t;
  for(const k of SLOTS){const it=a.slots[k];if(!it)continue;const s=itemStats(it);for(const x of STAT_KEYS)t[x]+=s[x]||0}return t}
// Summed item points for one stat, and what they are worth: max HP, attack, damage taken (a multiplier),
// crit chance (a fraction) and attack cooldown (a multiplier). Guard and Haste are capped.
export const gearStat=(a,k)=>(a.gtot||(a.gtot=statTotals(a)))[k]||0;
export const gearBonus=(a,k)=>{const v=gearStat(a,k)*STAT_RATE[k];return STAT_CAP[k]?Math.min(STAT_CAP[k],v):v};
export const gearHp=a=>a.slots?gearStat(a,'vigor')*STAT_RATE.vigor:(a.gear||0)*6;
export const gearAtk=a=>a.slots?gearStat(a,'might')*STAT_RATE.might:(a.gear||0)*1.5;
export const guardMul=a=>1-gearBonus(a,'guard')/100;
export const gearCrit=a=>gearBonus(a,'precision')/100;
export const hasteMul=a=>1/(1-gearBonus(a,'haste')/100); // cooldown ticks down this much faster

export function makeItem(cls,slot,ilvl,zone,opt={}){const z=clamp(zone,0,GEAR_MATERIALS.length-1),m=GEAR_MATERIALS[z];
  const mat=pickA(slot==='main'||slot==='off'?m.hard:m.any),noun=(SLOT_NOUNS[cls]||SLOT_NOUNS.Warrior)[slot];
  ilvl=Math.max(1,Math.round(ilvl));const quality=opt.quality||rollQuality(opt.fine==null?.25:opt.fine,opt.rare==null?.05:opt.rare,rnd());
  const r=rollStats(cls,slot,ilvl,z,quality),it={name:mat+' '+noun,ilvl,zone:z,slot,epic:false,quality,stats:r.stats};
  if(r.affixes.length)it.affixes=r.affixes;if(opt.src)it.src=opt.src;return it}

// Lowest item level among the non-epic slots (empty counts as 0); null if every slot holds an epic.
export function weakestSlot(a){let best=null,bs=1e9;for(const k of SLOTS){const it=a.slots[k];if(it&&it.epic)continue;const v=it?it.ilvl:0;if(v<bs){bs=v;best=k}}return best}

// Put an item in its slot and return what it replaced (or null). Epics are announced by getEpic;
// here only a slot's first item above level 10 is logged, to keep the Chronicle quiet.
export function equip(a,it){const old=a.slots[it.slot]||null;if(old)it.over={name:old.name,ilvl:old.ilvl,stats:{...itemStats(old)}}; // kept so the Gear tab can show the delta
  a.slots[it.slot]=it;syncGear(a);
  if(!it.epic&&it.ilvl>10&&(!old||old.ilvl<=10))log(a,' now wears ',{t:it.name,c:'gd'},' (item level ',String(it.ilvl),').');
  return old}

// A mob kill: about 6% of kills drop a slot item at the mob's level +-1; named elites always do.
// Upgrades are worn at once, the rest (and anything replaced) rides in the bag to be sold in town.
export function rollDrop(a,m,opt={}){if(!a.slots)return;if(!m.elite&&rnd()>=(opt.rate!=null?opt.rate:DROP_RATE))return;
  const M=MOBS[m.type],it=makeItem(a.cls,pickA(SLOTS),m.lvl+ri(-1,1),M?M.z:zoneFor(m.lvl),
    {src:'Dropped by '+(m.name||(M&&M.name)||'a monster'),quality:m.elite?(rnd()<.25?'rare':'fine'):undefined});
  const cur=a.slots[it.slot];
  if(cur&&(cur.epic||cur.ilvl>=it.ilvl)){a.bag.push(it);return}
  const old=equip(a,it);if(old)a.bag.push(old)}

// Town: sell any gear carried in the bag. Returns the gold and removes the items; goods stay.
export function sellGear(a){let g=0;a.bag=a.bag.filter(it=>{if(it&&typeof it==='object'&&it.slot){g+=SELL_VALUE(it);return false}return true});return g}

// Town: buy one item for the weakest slot at ilvl = hero level if it is an upgrade and gold allows.
// Greedy heroes (thrift < 1) only shop once the weakest slot has fallen a little further behind.
// Returns true when something was bought. offerUpgrade is the same deal at a merchant's item level.
export function shopUpgrade(a){let c=null;try{c=homeOf(a)}catch(e){}return offerUpgrade(a,a.lvl,c&&c.name?'Bought in '+c.name:'Bought in town')}
export function offerUpgrade(a,ilvl,src='Road merchant'){if(!a.slots)return false;refreshEpics(a);const k=weakestSlot(a);if(!k)return false;
  ilvl=Math.max(1,Math.round(ilvl));const cur=slotLevel(a,k),want=Math.max(1,Math.round(ilvl*tm(a,'thrift')));
  if(cur>=want||cur>=ilvl)return false;const cost=SHOP_COST(ilvl);if(a.gold<cost)return false;
  a.gold-=cost;const old=equip(a,makeItem(a.cls,k,ilvl,zoneFor(ilvl),{src,rare:0}));if(old)a.gold+=SELL_VALUE(old);return true}

// Epics take their slot outright (never displaced by ordinary gear) at hero level + 3 or better,
// and grow with their bearer: each town visit lifts a worn epic back to hero level + 3, so a
// Fang of the Old Wood looted at level 3 is not a dead slot at level 20.
export const EPIC_LEAD=3;
export function refreshEpics(a){for(const k of SLOTS){const it=a.slots[k];if(it&&it.epic&&it.ilvl<a.lvl+EPIC_LEAD){it.ilvl=a.lvl+EPIC_LEAD;it.stats=epicStats(it.name,it.ilvl)}}syncGear(a)}
export function equipEpic(a,name,src){if(!a.slots)return;const slot=EPIC_SLOT[name]||'trinket';
  const ilvl=Math.max(a.lvl+EPIC_LEAD,slotLevel(a,slot)+1);
  const old=equip(a,{name,ilvl,zone:epicZone(name),slot,epic:true,quality:'epic',stats:epicStats(name,ilvl),src:src||undefined});if(old)a.bag.push(old)}
