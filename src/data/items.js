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
