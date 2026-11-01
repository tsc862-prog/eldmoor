// Slot equipment: seven named, levelled items per hero replace the old single gear number.
// Drops (rollDrop), town upgrades (shopUpgrade), epic placement (equipEpic) and the derived
// gearScore that maxHp/atkOf read. Owned by creature-designer.
import {rnd,ri,clamp,pickA} from '../core/rng.js';
import {SLOTS,GEAR_MATERIALS,SLOT_NOUNS,EPIC_SLOT,epicZone} from '../data/items.js';
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
export const syncGear=a=>{a.gear=Math.round(gearScore(a))};
export const slotLevel=(a,k)=>a.slots[k]?a.slots[k].ilvl:0;

export function makeItem(cls,slot,ilvl,zone){const z=clamp(zone,0,GEAR_MATERIALS.length-1),m=GEAR_MATERIALS[z];
  const mat=pickA(slot==='main'||slot==='off'?m.hard:m.any),noun=(SLOT_NOUNS[cls]||SLOT_NOUNS.Warrior)[slot];
  return {name:mat+' '+noun,ilvl:Math.max(1,Math.round(ilvl)),zone:z,slot,epic:false}}

// Lowest item level among the non-epic slots (empty counts as 0); null if every slot holds an epic.
export function weakestSlot(a){let best=null,bs=1e9;for(const k of SLOTS){const it=a.slots[k];if(it&&it.epic)continue;const v=it?it.ilvl:0;if(v<bs){bs=v;best=k}}return best}

// Put an item in its slot and return what it replaced (or null). Epics are announced by getEpic;
// here only a slot's first item above level 10 is logged, to keep the Chronicle quiet.
export function equip(a,it){const old=a.slots[it.slot]||null;a.slots[it.slot]=it;syncGear(a);
  if(!it.epic&&it.ilvl>10&&(!old||old.ilvl<=10))log(a,' now wears ',{t:it.name,c:'gd'},' (item level ',String(it.ilvl),').');
  return old}

// A mob kill: about 6% of kills drop a slot item at the mob's level +-1; named elites always do.
// Upgrades are worn at once, the rest (and anything replaced) rides in the bag to be sold in town.
export function rollDrop(a,m){if(!a.slots)return;if(!m.elite&&rnd()>=DROP_RATE)return;
  const M=MOBS[m.type],it=makeItem(a.cls,pickA(SLOTS),m.lvl+ri(-1,1),M?M.z:zoneFor(m.lvl));
  const cur=a.slots[it.slot];
  if(cur&&(cur.epic||cur.ilvl>=it.ilvl)){a.bag.push(it);return}
  const old=equip(a,it);if(old)a.bag.push(old)}

// Town: sell any gear carried in the bag. Returns the gold and removes the items; goods stay.
export function sellGear(a){let g=0;a.bag=a.bag.filter(it=>{if(it&&typeof it==='object'&&it.slot){g+=SELL_VALUE(it);return false}return true});return g}

// Town: buy one item for the weakest slot at ilvl = hero level if it is an upgrade and gold allows.
// Greedy heroes (thrift < 1) only shop once the weakest slot has fallen a little further behind.
// Returns true when something was bought. offerUpgrade is the same deal at a merchant's item level.
export function shopUpgrade(a){return offerUpgrade(a,a.lvl)}
export function offerUpgrade(a,ilvl){if(!a.slots)return false;refreshEpics(a);const k=weakestSlot(a);if(!k)return false;
  ilvl=Math.max(1,Math.round(ilvl));const cur=slotLevel(a,k),want=Math.max(1,Math.round(ilvl*tm(a,'thrift')));
  if(cur>=want||cur>=ilvl)return false;const cost=SHOP_COST(ilvl);if(a.gold<cost)return false;
  a.gold-=cost;const old=equip(a,makeItem(a.cls,k,ilvl,zoneFor(ilvl)));if(old)a.gold+=SELL_VALUE(old);return true}

// Epics take their slot outright (never displaced by ordinary gear) at hero level + 3 or better,
// and grow with their bearer: each town visit lifts a worn epic back to hero level + 3, so a
// Fang of the Old Wood looted at level 3 is not a dead slot at level 20.
export const EPIC_LEAD=3;
export function refreshEpics(a){for(const k of SLOTS){const it=a.slots[k];if(it&&it.epic&&it.ilvl<a.lvl+EPIC_LEAD)it.ilvl=a.lvl+EPIC_LEAD}syncGear(a)}
export function equipEpic(a,name){if(!a.slots)return;const slot=EPIC_SLOT[name]||'trinket';
  const ilvl=Math.max(a.lvl+EPIC_LEAD,slotLevel(a,slot)+1);
  const old=equip(a,{name,ilvl,zone:epicZone(name),slot,epic:true});if(old)a.bag.push(old)}
