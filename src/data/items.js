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

// ---- item stats (issue #52) ----
// Five stats. Vigor raises max HP, Might attack, Guard cuts damage taken (percent, capped), Precision
// adds crit chance and Haste shortens the attack cooldown (capped). An item is
// {name, ilvl, zone, slot, epic, stats:{vigor?,might?,guard?,precision?,haste?}, quality, affixes?, src?}.
export const STAT_KEYS=['vigor','might','guard','precision','haste'];
export const STAT_NAMES={vigor:'Vigor',might:'Might',guard:'Guard',precision:'Precision',haste:'Haste'};
// What one stat point is worth: HP, attack, % less damage taken, % crit, % faster attacks. Vigor and
// Might are calibrated so a typical kit matches the old gearScore*6 HP and gearScore*1.5 attack;
// the other three are new power, kept small.
export const STAT_RATE={vigor:.98,might:.22,guard:.3,precision:.15,haste:.18};
export const STAT_CAP={guard:35,haste:25};
export const BUDGET_K=1.5;               // stat points per item level per unit of slot weight
// Slot weights sum to 7: head and chest carry more, a trinket less.
export const SLOT_WEIGHT={head:1.25,chest:1.25,hands:.9,feet:.9,main:1.2,off:.9,trinket:.6};
// Per-slot lean: weapons Might/Haste, armour Vigor/Guard, trinkets Precision/Haste.
export const SLOT_LEAN={
  head:{vigor:1.2,guard:1.3},chest:{vigor:1.3,guard:1.4},hands:{might:1.2,guard:1.1},feet:{vigor:1.1,haste:1.3},
  main:{might:1.6,haste:1.3,precision:1.1},off:{guard:1.3,precision:1.2},trinket:{precision:1.8,haste:1.6,might:1.1}};
// Class lean: how a class's gear tilts across the five stats (shares of an item's budget).
export const CLASS_SHARE={
  Warrior:{vigor:.42,might:.24,guard:.2,precision:.06,haste:.08},
  Mage:{vigor:.24,might:.4,guard:.04,precision:.12,haste:.2},
  Priest:{vigor:.32,might:.3,guard:.08,precision:.06,haste:.24},
  Hunter:{vigor:.3,might:.32,guard:.06,precision:.2,haste:.12},
  Rogue:{vigor:.28,might:.32,guard:.04,precision:.2,haste:.16}};
// Quality: plain 70%, fine 25% (+15% budget, one affix), rare 5% (+35%, two affixes).
export const QUALITY={plain:{mult:1,affixes:0,label:'Plain'},fine:{mult:1.15,affixes:1,label:'Fine'},rare:{mult:1.35,affixes:2,label:'Rare'}};
export const rollQuality=(fine,rare,r)=>r<rare?'rare':r<rare+fine?'fine':'plain';
// Zone affixes: [words, stat the affix leans toward]. Original vocabulary of each land.
export const AFFIXES=[
  [['of the Briar','guard'],['of the Hollow Oak','vigor'],['of the Hare','haste'],['of the Wolf Run','might']],
  [['of the Mire','vigor'],['of Still Water','guard'],['of the Fen Light','precision'],['of the Heron','haste']],
  [['of the Ember','might'],['of the Forge','guard'],['of the Cinderfall','precision'],['of the Slagwind','haste']],
  [['of the Rime','guard'],['of the Hoarwind','haste'],['of the Long Night','vigor'],['of the Drift','precision']]];

// Epic stat blocks: ratios of the item's level (stat = round(ilvl * ratio)), so a relic grows with its
// bearer. A block totals about 2.4 to 3.7 per ilvl, against roughly 2 for an ordinary piece.
export const EPIC_STATS={
  'Fang of the Old Wood':{r:{might:1.3,haste:.8,precision:.7,vigor:.4},flavour:"Cut from a hollow oak's first limb; it hums when wolves are near."},
  'Thornheart Longbow':{r:{precision:1,might:.8,haste:.6},flavour:'The string is wound with bramble fibre and never goes slack.'},
  'Bramblecrown':{r:{vigor:1.5,guard:.9,precision:.5,haste:.4},flavour:'Thorns turned inward, which is how a brave head is told from a foolish one.'},
  'Mosswoven Cloak':{r:{vigor:1.6,guard:1,haste:.7},flavour:'Grown rather than sewn; the bog keeps its wearer warm.'},
  'Bogwalker Boots':{r:{vigor:.9,haste:.9,guard:.6},flavour:'The mud lets go of them a heartbeat early.'},
  'Fenlight Lantern':{r:{might:.9,precision:.8,vigor:.7},flavour:'A pale flame that shows where a foe is weakest.'},
  'Ember-Forged Greatsword':{r:{might:1.6,precision:.8,haste:.6,vigor:.4},flavour:'Quenched in Cinderpass ash; it is never quite cold.'},
  'Cinderscale Mantle':{r:{vigor:1.4,guard:1.3,might:.7},flavour:'Scales shed by something that did not need them any more.'},
  'Magma-Tempered Gauntlets':{r:{might:.9,guard:.7,haste:.8},flavour:'They glow when a grip is about to matter.'},
  'Rime-Etched Warpick':{r:{might:1.5,vigor:.8,guard:.6,precision:.5},flavour:'Frost patterns crawl up the haft with every swing.'},
  'Shaghorn Greatcloak':{r:{vigor:1.7,guard:1.2,haste:.5},flavour:'Hide of the shaghorn, heavy as a promise to stay alive.'},
  'Icevein Diadem':{r:{might:1,precision:.9,vigor:.9,haste:.6},flavour:'Cold enough to sharpen thought, and nothing else.'},
  "Kragmaw's Molten Eye":{r:{precision:1,might:.7,haste:.5},flavour:'It still watches the lair it was torn from.'},
  'Wyrmbone Crown':{r:{vigor:1.6,guard:1,might:.7,precision:.4},flavour:'A crown for someone who has already won.'},
  'Cinder Wyrm Fang':{r:{might:1.8,haste:.9,precision:.6,vigor:.4},flavour:'A tooth as long as a forearm, and twice as eager.'},
  'Mantle of the Ashen King':{r:{vigor:1.8,guard:1.4,might:.5},flavour:'Ash drifts from its hem and never reaches the floor.'},
  "Vesk's Phylactery Shard":{r:{might:.9,haste:.7,vigor:.6},flavour:'A sliver of a lich that wanted to be remembered.'},
  "Drowned King's Signet":{r:{precision:.9,vigor:.7,guard:.6},flavour:'Still wet, no matter how long it is worn.'},
  'Cryptbound Greaves':{r:{vigor:1.1,guard:.8,haste:.7},flavour:'Made to stand a long vigil, and to leave it quickly.'},
  'Staff of Still Water':{r:{might:1.4,haste:1,vigor:.6,guard:.4},flavour:'Not a ripple on it, even in the middle of a fight.'}};
