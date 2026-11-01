// Epic item tables and the auction-house goods list. Owned by creature-designer.
import {ri,clamp} from '../core/rng.js';

// Indexed by zone: a mob kill in zone z rolls from EPICS[z].
export const EPICS=[["Fang of the Old Wood","Thornheart Longbow","Bramblecrown"],["Mosswoven Cloak","Bogwalker Boots","Fenlight Lantern"],["Ember-Forged Greatsword","Cinderscale Mantle","Magma-Tempered Gauntlets"],["Rime-Etched Warpick","Shaghorn Greatcloak","Icevein Diadem"]];
export const BOSS_EPICS=["Kragmaw's Molten Eye","Wyrmbone Crown","Cinder Wyrm Fang","Mantle of the Ashen King"];
export const DG_EPICS=["Vesk's Phylactery Shard","Drowned King's Signet","Cryptbound Greaves","Staff of Still Water"];

export const GOODS={};
[['Grave Dust',18],['Wolf Pelt',4],['Boar Tusk',5],['Silk Bundle',7],['Fen Moss',9],['Thick Hide',11],['Venom Sac',14],['Ember Core',22],['Cinder Scale',26],['Rime Pelt',30],['Hoar Wool',34],['Wight Marrow',40]]
  .forEach(([n,b])=>GOODS[n]={base:b,supply:ri(2,14),prev:0});
export const price=n=>{const g=GOODS[n];return Math.max(1,Math.round(g.base*clamp(1.5-g.supply*.035,.35,1.8)))};
for(const n in GOODS)GOODS[n].prev=price(n);

// ---- slot equipment (issue #20) ----
// Seven slots per hero. An item is {name, ilvl, zone, slot, epic}. Names are "<material> <slot noun>":
// the material comes from the zone the item was found in (or the zone of the hero's level when bought
// in town), the noun from the hero's class (cloth for Mage/Priest, leather for Hunter/Rogue, plate for Warrior).
export const SLOTS=['head','chest','hands','feet','main','off','trinket'];
// Per-zone materials. `hard` is the subset fit for weapons and shields (main and off hand).
export const GEAR_MATERIALS=[
  {any:['Bramble','Oakbark','Wolfhide'],hard:['Oakbark']},
  {any:['Mossweave','Bogiron','Fenleather'],hard:['Bogiron']},
  {any:['Cinder','Emberforged','Ashsteel'],hard:['Emberforged','Ashsteel']},
  {any:['Rime','Hoarfrost','Icevein'],hard:['Icevein']}];
export const SLOT_NOUNS={
  Warrior:{head:'Helm',chest:'Breastplate',hands:'Gauntlets',feet:'Greaves',main:'Longsword',off:'Shield',trinket:'Medallion'},
  Mage:{head:'Cowl',chest:'Robe',hands:'Wraps',feet:'Sandals',main:'Staff',off:'Grimoire',trinket:'Charm'},
  Priest:{head:'Circlet',chest:'Vestment',hands:'Mitts',feet:'Slippers',main:'Mace',off:'Censer',trinket:'Reliquary'},
  Hunter:{head:'Hood',chest:'Jerkin',hands:'Gloves',feet:'Treads',main:'Hatchet',off:'Longbow',trinket:'Talisman'},
  Rogue:{head:'Mask',chest:'Vest',hands:'Grips',feet:'Softboots',main:'Dagger',off:'Shiv',trinket:'Lockcharm'}};
// Which slot each named epic occupies when looted.
export const EPIC_SLOT={
  'Fang of the Old Wood':'main','Thornheart Longbow':'off','Bramblecrown':'head',
  'Mosswoven Cloak':'chest','Bogwalker Boots':'feet','Fenlight Lantern':'off',
  'Ember-Forged Greatsword':'main','Cinderscale Mantle':'chest','Magma-Tempered Gauntlets':'hands',
  'Rime-Etched Warpick':'main','Shaghorn Greatcloak':'chest','Icevein Diadem':'head',
  "Kragmaw's Molten Eye":'trinket','Wyrmbone Crown':'head','Cinder Wyrm Fang':'main','Mantle of the Ashen King':'chest',
  "Vesk's Phylactery Shard":'trinket',"Drowned King's Signet":'trinket','Cryptbound Greaves':'feet','Staff of Still Water':'main'};
// Zone of origin for an epic: its zone table; Kragmaw's epics are Cinderpass, the Crypt's are Mirefen.
export const epicZone=n=>{const z=EPICS.findIndex(l=>l.includes(n));return z>=0?z:BOSS_EPICS.includes(n)?2:1};
