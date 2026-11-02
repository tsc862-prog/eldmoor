// Slot equipment: seven named, levelled items per hero replace the old single gear number.
// Drops (rollDrop), town upgrades (shopUpgrade), epic placement (equipEpic) and the gear score.
// Owned by creature-designer. What items are worth in a fight is worked out in sim/stats.js
// (combatStats): items carry armor, weapon damage, score bonuses and rare properties (issue #88).
import {rnd,ri,clamp,pickA} from '../core/rng.js';
import {SLOTS,GEAR_MATERIALS,SLOT_NOUNS,EPIC_SLOT,epicZone,QUALITY,rollQuality,AFFIXES,EPIC_ITEMS,
  ARMOR_PER_ILVL,DAMAGE_PER_ILVL,ARMOR_SLOT,ARMOR_CLASS,WEAPON_SLOTS,SHIELD_CLASS,PROP_IDS} from '../data/items.js';
import {CLASS_ABIL} from '../data/abilities.js';
import {homeOf} from '../data/races.js';
import {MOBS} from '../data/mobs.js';
import {tm} from '../data/traits.js';
import {zoneFor} from '../world/map.js';
import {log} from './chronicle.js';
import {dmgTaken} from './stats.js';
import {wakeLoot} from './wakes.js';
import {addGear} from './inv.js'; // spare gear rides in the pack (sim/inv.js)

// Tuning. gearScore = average item level over the seven slots * GEAR_K: a rough "how kitted" figure
// for raid musters (boss.js), dungeon power (dungeon.js) and the Gear tab. Combat reads combatStats.
export const GEAR_K=.65;
export const DROP_RATE=.06;            // slot item per ordinary kill; named elites always drop one
export const SHOP_COST=ilvl=>6*ilvl;   // gold for a town-bought item
export const SELL_VALUE=it=>it.ilvl*2; // gold the auction house pays for a replaced or unwanted item

export function emptySlots(){const s={};for(const k of SLOTS)s[k]=null;return s}
export function gearScore(a){if(!a.slots)return a.gear||0;let t=0;for(const k of SLOTS){const it=a.slots[k];if(it)t+=it.ilvl}return t/SLOTS.length*GEAR_K}
export const syncGear=a=>{a.gear=Math.round(gearScore(a));if('gtot' in a)delete a.gtot};
export const slotLevel=(a,k)=>a.slots[k]?a.slots[k].ilvl:0;
// Damage multiplier for a blow landing on a hero (class training, armor, warding). Kept under its old
// name for callers that predate sim/stats.js; prefer dmgTaken from there.
export const guardMul=a=>dmgTaken(a);

// ---- item properties (issue #88) ----
// What a slot carries for a class: armor weight, damage share, or (tome, censer, shiv, trinket) a score.
export const armorWeight=(cls,slot)=>slot==='off'&&!SHIELD_CLASS[cls]?0:(ARMOR_SLOT[slot]||0)*(ARMOR_CLASS[cls]||.3);
export const damageShare=(cls,slot)=>((WEAPON_SLOTS[cls]||WEAPON_SLOTS.Warrior)[slot])||0;
const charmSlot=(cls,slot)=>slot==='trinket'||(slot==='off'&&!armorWeight(cls,slot)&&!damageShare(cls,slot));
export const itemArmor=(cls,slot,ilvl,mult=1)=>{const w=armorWeight(cls,slot);return w?Math.max(1,Math.round(ilvl*ARMOR_PER_ILVL*w*mult)):0};
export const itemDamage=(cls,slot,ilvl,mult=1)=>{const w=damageShare(cls,slot);return w?Math.max(1,Math.round(ilvl*DAMAGE_PER_ILVL*w*mult)):0};
// Affixes lean toward the class's scores: primary x3, secondary x2, the rest x1.
const affixW=(cls,score)=>{const ca=CLASS_ABIL[cls];return !ca?1:score===ca.primary?3:score===ca.secondary?2:1};
function pickAffix(cls,pool){let tot=0;for(const x of pool)tot+=affixW(cls,x[1]);let r=rnd()*tot;
  for(let i=0;i<pool.length;i++){r-=affixW(cls,pool[i][1]);if(r<=0)return pool.splice(i,1)[0]}return pool.pop()}
const addBonus=(b,k,n)=>{b[k]=(b[k]||0)+n};

// Roll an ordinary item's properties. Fine: one affix, +1 to its score. Rare: two affixes (+1 each),
// or a third of the time one affix at +2; and one property. Trinkets and charm off hands add +1 to the
// class's primary (trinket) or secondary (off hand) at every quality.
function rollProps(cls,slot,ilvl,zone,quality){
  const Q=QUALITY[quality],it={},pool=(AFFIXES[zone]||AFFIXES[0]).slice(),bonus={},aff=[];
  const ar=itemArmor(cls,slot,ilvl,Q.mult),dm=itemDamage(cls,slot,ilvl,Q.mult);if(ar)it.armor=ar;if(dm)it.damage=dm;
  const double=quality==='rare'&&rnd()<1/3,n=double?1:Q.affixes;
  for(let i=0;i<n&&pool.length;i++){const x=pickAffix(cls,pool);aff.push(x[0]);addBonus(bonus,x[1],double?2:1)}
  if(charmSlot(cls,slot)){const ca=CLASS_ABIL[cls];if(ca)addBonus(bonus,slot==='trinket'?ca.primary:ca.secondary,1)}
  if(Object.keys(bonus).length)it.bonus=bonus;
  if(quality==='rare')it.property=pickA(PROP_IDS);
  if(aff.length)it.affixes=aff;
  return it}
// An epic's armor and damage at its current level (plate armor, a plain weapon's damage, times the
// relic's multiplier) plus its fixed bonus and property.
export function epicProps(name,ilvl){const E=EPIC_ITEMS[name],slot=EPIC_SLOT[name]||'trinket',it={};if(!E)return it;
  if(E.armor)it.armor=Math.max(1,Math.round(ilvl*ARMOR_PER_ILVL*(ARMOR_SLOT[slot]||1)*E.armor));
  if(E.damage)it.damage=Math.max(1,Math.round(ilvl*DAMAGE_PER_ILVL*E.damage));
  if(E.bonus)it.bonus={...E.bonus};if(E.property)it.property=E.property;return it}
const setEpic=(it)=>{const p=epicProps(it.name,it.ilvl);delete it.armor;delete it.damage;Object.assign(it,p)};

// opt: {quality, fine, rare, src}. Signature unchanged since #20.
export function makeItem(cls,slot,ilvl,zone,opt={}){const z=clamp(zone,0,GEAR_MATERIALS.length-1),m=GEAR_MATERIALS[z];
  const mat=pickA(slot==='main'||slot==='off'?m.hard:m.any),noun=(SLOT_NOUNS[cls]||SLOT_NOUNS.Warrior)[slot];
  ilvl=Math.max(1,Math.round(ilvl));const quality=opt.quality||rollQuality(opt.fine==null?.25:opt.fine,opt.rare==null?.05:opt.rare,rnd());
  const it={name:mat+' '+noun,ilvl,zone:z,slot,epic:false,quality,cls,...rollProps(cls,slot,ilvl,z,quality)};
  if(opt.src)it.src=opt.src;return it}

// Save migration (v3 -> v4): an item from before #88 carried {stats:{vigor,might,guard,precision,haste}}.
// Its armor and damage are re-derived from its slot, class and level at its quality. Score bonuses
// follow its affixes (each affix now names a score, data/items.js AFFIXES); an affix the tables no longer
// know falls back to the item's biggest old stat (Vigor -> Grit, Might -> the class primary, Precision ->
// Reflex). A rare gets the property nearest its old lean (Guard warding, Haste swift, Precision keen,
// else vital). Epics take their new block. The replaced-piece note loses its old stats.
export function convertItem(it,cls){if(!it||typeof it!=='object'||!it.slot)return it;
  const old=it.stats||{};delete it.stats;delete it.armor;delete it.damage;delete it.bonus;delete it.property;
  if(it.over&&it.over.stats)delete it.over.stats;
  if(it.epic){setEpic(it);return it}
  const q=QUALITY[it.quality]?it.quality:'plain',Q=QUALITY[q];it.quality=q;
  const ar=itemArmor(cls,it.slot,it.ilvl,Q.mult),dm=itemDamage(cls,it.slot,it.ilvl,Q.mult);if(ar)it.armor=ar;if(dm)it.damage=dm;
  const ca=CLASS_ABIL[cls]||{primary:'brawn',secondary:'grit'};
  const wt={grit:old.vigor||0,[ca.primary]:old.might||0,reflex:old.precision||0};
  const pts=q==='rare'?2:q==='fine'?1:0,b={},known=new Map(AFFIXES.flat().map(x=>[x[0],x[1]]));
  const order=Object.keys(wt).filter(k=>wt[k]>0).sort((x,y)=>wt[y]-wt[x]);let left=pts;
  for(const f of it.affixes||[]){if(left<=0)break;const k=known.get(f);if(k){addBonus(b,k,1);left--}}
  for(let i=0;left>0&&order.length;i++,left--)addBonus(b,order[i%order.length],1);
  if(charmSlot(cls,it.slot))addBonus(b,it.slot==='trinket'?ca.primary:ca.secondary,1);
  if(Object.keys(b).length)it.bonus=b;
  if(q==='rare'){const g=old.guard||0,h=old.haste||0,p=old.precision||0,v=old.vigor||0;
    it.property=g>=h&&g>=p&&g>=v/3?'warding':h>=p&&h>=v/3?'swift':p>=v/3?'keen':'vital'}
  return it}

// Lowest item level among the non-epic slots (empty counts as 0); null if every slot holds an epic.
export function weakestSlot(a){let best=null,bs=1e9;for(const k of SLOTS){const it=a.slots[k];if(it&&it.epic)continue;const v=it?it.ilvl:0;if(v<bs){bs=v;best=k}}return best}

// An item's numbers in one flat map, {armor, damage, <score>: n}, for text read-outs (sim/player.js).
// The property is not a number; read it.property.
export function itemStats(it){const o={};if(!it)return o;if(it.armor)o.armor=it.armor;if(it.damage)o.damage=it.damage;
  for(const k in it.bonus||{})o[k]=it.bonus[k];return o}
// What an item adds, for the replaced-piece note: {armor, damage, bonus, property}.
const summary=it=>{const o={};if(it.armor)o.armor=it.armor;if(it.damage)o.damage=it.damage;if(it.bonus)o.bonus={...it.bonus};if(it.property)o.property=it.property;return o};
// Put an item in its slot and return what it replaced (or null). Epics are announced by getEpic;
// here only a slot's first item above level 10 is logged, to keep the Chronicle quiet.
export function equip(a,it){const old=a.slots[it.slot]||null;if(old)it.over={name:old.name,ilvl:old.ilvl,...summary(old)}; // kept so the Gear tab can show the delta
  a.slots[it.slot]=it;syncGear(a);
  if(!it.epic&&it.ilvl>10&&(!old||old.ilvl<=10))log(a,' now wears ',{t:it.name,c:'gd'},' (item level ',String(it.ilvl),').');
  return old}

// A mob kill: about 6% of kills drop a slot item at the mob's level +-1; named elites always do.
// Upgrades are worn at once, the rest (and anything replaced) rides in the pack (sim/inv.js) to be sold in town.
export function rollDrop(a,m,opt={}){if(!a.slots)return;if(!m.elite&&rnd()>=(opt.rate!=null?opt.rate:DROP_RATE))return;
  const M=MOBS[m.type],it=makeItem(a.cls,pickA(SLOTS),m.lvl+ri(-1,1),M?M.z:zoneFor(m.lvl),
    {src:'Dropped by '+(m.name||(M&&M.name)||'a monster'),quality:m.elite?(rnd()<.25?'rare':'fine'):undefined});
  wakeLoot(a,it.name,it.quality);const cur=a.slots[it.slot];
  if(cur&&(cur.epic||cur.ilvl>=it.ilvl)){addGear(a,it);return}
  const old=equip(a,it);if(old)addGear(a,old)}

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
export function refreshEpics(a){for(const k of SLOTS){const it=a.slots[k];if(it&&it.epic&&it.ilvl<a.lvl+EPIC_LEAD){it.ilvl=a.lvl+EPIC_LEAD;setEpic(it)}}syncGear(a)}
export function equipEpic(a,name,src){if(!a.slots)return;const slot=EPIC_SLOT[name]||'trinket';
  const ilvl=Math.max(a.lvl+EPIC_LEAD,slotLevel(a,slot)+1);
  const old=equip(a,{name,ilvl,zone:epicZone(name),slot,epic:true,quality:'epic',...epicProps(name,ilvl),src:src||undefined});if(old)addGear(a,old)}
