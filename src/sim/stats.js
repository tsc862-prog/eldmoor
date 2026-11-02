// Combat totals (issue #88): the one place a hero's Health, Attack, Defense, Crit and Speed are worked
// out. Owned by character-builder. The six ability scores (sim/abilities.js, gear bonuses included)
// are the only attributes; items add armor, weapon damage and rare properties (data/items.js).
//
// combatStats(a) -> {health, attack, defense, crit, speed, aps, armor, damage, bd}
//   health   max hit points
//   attack   mean damage of one blow before the 0.8-1.2 roll, crit and target defense
//   defense  fraction of every blow turned aside (0..DEF_CAP); damage taken = 1 - defense
//   crit     chance of a critical blow (x1.8)
//   speed    attack-rate multiplier (the 1.1 s swing timer runs this much faster); aps = blows per second
//   bd       {health:[...], attack:[...], defense:[...], crit:[...], speed:[...]}, each a list of
//            {src:'class'|'level'|'score:<id>'|'gear'|'epic'|'property', label, value} summing to the total
// Readers: heroes.js (maxHp, atkOf, strike, the swing timer), mobs.js, boss.js and narrator.js (dmgTaken),
// brain.js (snapshot), ui/panels.js (Stats tab). The result is cached per hero and rebuilt only when the
// level, class, scores, epics or worn items change, so hot paths may call it every step. Never mutate it.
import {CLS} from '../data/classes.js';
import {CLASS_ABIL,ABILITIES} from '../data/abilities.js';
import {SLOTS,PROPS,USES} from '../data/items.js';
import {mod} from './abilities.js';
import {passiveSum,effMul,passiveTaken} from './eff.js'; // class passives and timed effects (sim/eff.js, #81)

// ---- tuning (calibrated against the pre-#88 formulas; see the PR for the band averages) ----
export const SWING=1.1;              // seconds between blows at speed 1
export const DEF_CAP=.5;             // no hero turns aside more than half of a blow
export const ARMOR_RATE=.0017;       // defense per armor point
export const EPIC_HP=10,EPIC_ATK=3;  // every epic ever looted (a.epics), as before #88
export const BASE_CRIT=.08;          // classes without their own crit
const CRIT_PER=.008,CRIT_REF=1.5;    // crit per Reflex modifier point, around the average hero
// Seasoning: past level 11 a veteran's blows land true more often (what the old Precision stat gave the
// average high-level hero): +0.6% at 12, +2.2% at 17, +4.9% at 20.
export const lvlCrit=l=>l>11?.0006*(l-11)*(l-11):0;
// Level terms. Health and attack per level absorb what the old gear stats (Vigor, Might) gave an
// average hero of that level, so population figures stay where they were.
export const lvlHp=l=>Math.round(13.3*l+Math.max(.5*l,4.6*l-8));
export const lvlAtk=l=>2.1*l-1.6-.01*l*l;
// The primary score's weight in attack grows with level.
export const scoreAtkW=l=>.6+.1*l;

const r1=v=>Math.round(v*10)/10;
const pct=v=>Math.round(v*1000)/10+'%';
const sg=v=>(v>=0?'+':'')+v;

// Summed armor, damage and properties of the worn items.
function gearSums(a){const t={armor:0,damage:0,props:{}};const s=a.slots;if(!s)return t;
  for(const k of SLOTS){const it=s[k];if(!it)continue;t.armor+=it.armor||0;t.damage+=it.damage||0;
    if(it.property&&PROPS[it.property])t.props[it.property]=(t.props[it.property]||0)+1}
  return t}

function build(a){
  const c=CLS[a.cls],l=a.lvl,ne=(a.epics||[]).length,g=gearSums(a),P=g.props,bd={health:[],attack:[],defense:[],crit:[],speed:[]};
  const ca=CLASS_ABIL[a.cls],prim=ca?ca.primary:'brawn';
  // Health
  const gm=mod(a,'grit');let hp=0;
  const H=(src,label,v)=>{bd.health.push({src,label,value:Math.round(v)});hp+=v};
  H('class',a.cls+' base',c.hp);H('level','Level '+l,lvlHp(l));H('score:grit','Grit '+sg(gm)+' x '+l,gm*l);
  if(ne)H('epic',ne+' epic'+(ne>1?'s':'')+' looted',ne*EPIC_HP);
  if(P.vital){const v=hp*PROPS.vital.v*P.vital;H('property','vital'+(P.vital>1?' x'+P.vital:'')+' (+'+Math.round(PROPS.vital.v*P.vital*100)+'%)',v)}
  const pHp=passiveSum(a,'health');if(pHp)H('passive','Passives (+'+Math.round(pHp*100)+'%)',hp*pHp);
  // Attack
  const pm=mod(a,prim);let atk=0;
  const A=(src,label,v)=>{bd.attack.push({src,label,value:r1(v)});atk+=v};
  A('class',a.cls+' base',c.atk);A('level','Level '+l,lvlAtk(l));A('score:'+prim,ABILITIES[prim].name+' '+sg(pm),pm*scoreAtkW(l));
  if(g.damage)A('gear','Weapon damage',g.damage);
  if(ne)A('epic',ne+' epic'+(ne>1?'s':'')+' looted',ne*EPIC_ATK);
  // Defense: class armour and item armor multiply (each turns aside a share of what is left), warding adds, capped.
  const cd=c.def||0,ad=Math.min(DEF_CAP,g.armor*ARMOR_RATE),wd=(P.warding||0)*PROPS.warding.v;
  let def=1-(1-cd)*(1-ad);const pd=passiveSum(a,'defense');
  if(cd)bd.defense.push({src:'class',label:a.cls+' training',value:cd});
  if(g.armor)bd.defense.push({src:'gear',label:g.armor+' armor',value:def-cd});
  if(wd){bd.defense.push({src:'property','label':'warding'+(P.warding>1?' x'+P.warding:''),value:wd});def+=wd}
  if(pd){bd.defense.push({src:'passive',label:'Passives',value:pd});def+=pd}
  if(def>DEF_CAP){bd.defense.push({src:'cap',label:'cap '+pct(DEF_CAP),value:DEF_CAP-def});def=DEF_CAP}
  // Crit
  const rm=mod(a,'reflex'),cc=c.crit||BASE_CRIT,rc=(rm-CRIT_REF)*CRIT_PER,kc=(P.keen||0)*PROPS.keen.v;
  const lc=lvlCrit(l);bd.crit.push({src:'class',label:a.cls+' base',value:cc});if(lc)bd.crit.push({src:'level',label:'Level '+l+' (seasoned)',value:lc});
  bd.crit.push({src:'score:reflex',label:'Reflex '+sg(rm),value:rc});
  if(kc)bd.crit.push({src:'property',label:'keen'+(P.keen>1?' x'+P.keen:''),value:kc});
  const pc=passiveSum(a,'crit');if(pc)bd.crit.push({src:'passive',label:'Passives',value:pc});
  const crit=Math.max(0,cc+lc+rc+kc+pc);
  // Speed
  const sw=(P.swift||0)*PROPS.swift.v,speed=(c.spd||1)+sw;
  bd.speed.push({src:'class',label:a.cls+' swing',value:c.spd||1});
  if(sw)bd.speed.push({src:'property',label:'swift'+(P.swift>1?' x'+P.swift:''),value:sw});
  return {health:Math.round(hp),attack:atk,defense:def,crit,speed,aps:speed/SWING,armor:g.armor,damage:g.damage,bd}}

// Cache: rebuilt when anything the totals read has changed (worn items are compared by identity and
// level, since a smith reworks an epic in place).
const cache=new WeakMap();
function sig(a){const s=a.slots,ab=a.abil,parts=[a.cls,a.lvl,(a.epics||[]).length];
  if(ab)for(const k in ab)parts.push(ab[k]);
  return parts.join(',')}
function same(e,a,k){if(e.k!==k)return false;const s=a.slots;if(!s)return !e.items;if(!e.items)return false;
  for(let i=0;i<SLOTS.length;i++){const it=s[SLOTS[i]]||null;if(e.items[i]!==it||(it&&e.lv[i]!==it.ilvl))return false}return true}
export function combatStats(a){const k=sig(a),e=cache.get(a);if(e&&same(e,a,k))return e.v;
  const s=a.slots,items=s?SLOTS.map(x=>s[x]||null):null,v=build(a);
  cache.set(a,{k,items,lv:items?items.map(it=>it?it.ilvl:0):null,v});return v}
// Damage multiplier for a blow landing on this hero.
export const dmgTaken=a=>(1-combatStats(a).defense)*(a.wardT>0?1-USES['Scroll of the Steadfast Hour'].ward:1)*effMul(a,'taken')*passiveTaken(a,a.hp/combatStats(a).health); // Ward of Dawn, Bastion and the class passives (sim/eff.js, #81); a warding scroll (sim/inv.js) softens every blow while it holds
