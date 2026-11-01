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

// ---- item properties (issue #88) ----
// Items carry no attributes of their own: the six ability scores (data/abilities.js) are the only
// attributes in the game. An item is
//   {name, ilvl, zone, slot, epic, quality, armor?, damage?, bonus?:{score:n}, property?, affixes?, src?}
// armor:    head, chest, hands, feet and a Warrior's shield. Summed armor becomes Defense (sim/stats.js).
// damage:   the main hand, and a Hunter's longbow (a ranged off hand). Summed damage adds to Attack.
// bonus:    points added to ability scores while worn ("+2 Brawn"): fine items one +1, rare items two
//           +1 or one +2; trinkets and the other off hands (tome, censer, shiv) a +1 at every quality.
// property: rare items and most epics carry one word from PROPS.
// Armor and damage scale with item level and quality; bonuses and properties do not.
export const ARMOR_PER_ILVL=1;    // armor points per item level, before slot and class weights
export const DAMAGE_PER_ILVL=.68; // weapon damage per item level, before the class split
export const ARMOR_SLOT={head:1.2,chest:1.6,hands:.6,feet:.6,off:1}; // `off` only for a class with a shield
// Plate, leather and cloth: how much armor a class's pieces carry.
export const ARMOR_CLASS={Warrior:1,Hunter:.3,Rogue:.25,Mage:.2,Priest:.25};
// Which slots carry damage for each class, and their share. Hunters split it between hatchet and longbow.
export const WEAPON_SLOTS={Warrior:{main:1},Mage:{main:1},Priest:{main:1},Rogue:{main:1},Hunter:{main:.5,off:.5}};
export const SHIELD_CLASS={Warrior:true};
// Rare properties: one word, one effect, added to the combat total named in `stat`.
export const PROPS={
  swift:  {name:'swift',  desc:'+8% attack speed',stat:'speed',  v:.08},
  keen:   {name:'keen',   desc:'+3% crit',        stat:'crit',   v:.03},
  warding:{name:'warding',desc:'+5% defense',     stat:'defense',v:.05},
  vital:  {name:'vital',  desc:'+5% health',      stat:'health', v:.05}};
export const PROP_IDS=Object.keys(PROPS);
// Quality: plain 70%, fine 25% (armor and damage +15%, one affix), rare 5% (+35%, two affixes, a property).
export const QUALITY={plain:{mult:1,affixes:0,label:'Plain'},fine:{mult:1.15,affixes:1,label:'Fine'},rare:{mult:1.35,affixes:2,label:'Rare'}};
export const rollQuality=(fine,rare,r)=>r<rare?'rare':r<rare+fine?'fine':'plain';
// Zone affixes: [words, the score the affix raises]. Original vocabulary of each land.
export const AFFIXES=[
  [['of the Briar','grit'],['of the Hollow Oak','insight'],['of the Hare','reflex'],['of the Wolf Run','brawn']],
  [['of the Mire','grit'],['of Still Water','wits'],['of the Fen Light','insight'],['of the Heron','reflex']],
  [['of the Ember','brawn'],['of the Forge','grit'],['of the Cinderfall','presence'],['of the Slagwind','reflex']],
  [['of the Rime','grit'],['of the Hoarwind','reflex'],['of the Long Night','wits'],['of the Drift','presence']]];

// Epic blocks. armor and damage are multipliers on an ordinary plain piece of that slot at the epic's
// item level (armor counted as plate, so a relic shields a Mage as well as a Warrior), so a relic grows
// with its bearer; bonus and property are fixed. Hand-authored: each relic is for one thing.
export const EPIC_ITEMS={
  'Fang of the Old Wood':{damage:1.35,bonus:{reflex:1,brawn:1},property:'swift',flavour:"Cut from a hollow oak's first limb; it hums when wolves are near."},
  'Thornheart Longbow':{damage:.8,bonus:{reflex:2},property:'keen',flavour:'The string is wound with bramble fibre and never goes slack.'},
  'Bramblecrown':{armor:1.1,bonus:{grit:2},flavour:'Thorns turned inward, which is how a brave head is told from a foolish one.'},
  'Mosswoven Cloak':{armor:1,bonus:{grit:1,insight:1},property:'vital',flavour:'Grown rather than sewn; the bog keeps its wearer warm.'},
  'Bogwalker Boots':{armor:1,bonus:{reflex:1,grit:1},property:'swift',flavour:'The mud lets go of them a heartbeat early.'},
  'Fenlight Lantern':{bonus:{insight:2,wits:1},property:'keen',flavour:'A pale flame that shows where a foe is weakest.'},
  'Ember-Forged Greatsword':{damage:1.45,bonus:{brawn:2},flavour:'Quenched in Cinderpass ash; it is never quite cold.'},
  'Cinderscale Mantle':{armor:1.25,bonus:{grit:1,brawn:1},property:'warding',flavour:'Scales shed by something that did not need them any more.'},
  'Magma-Tempered Gauntlets':{armor:1.1,bonus:{brawn:2},property:'swift',flavour:'They glow when a grip is about to matter.'},
  'Rime-Etched Warpick':{damage:1.4,bonus:{brawn:1,grit:1},property:'keen',flavour:'Frost patterns crawl up the haft with every swing.'},
  'Shaghorn Greatcloak':{armor:1.3,bonus:{grit:2},property:'vital',flavour:'Hide of the shaghorn, heavy as a promise to stay alive.'},
  'Icevein Diadem':{armor:.9,bonus:{wits:2,insight:1},property:'keen',flavour:'Cold enough to sharpen thought, and nothing else.'},
  "Kragmaw's Molten Eye":{bonus:{reflex:2,wits:1},property:'keen',flavour:'It still watches the lair it was torn from.'},
  'Wyrmbone Crown':{armor:1.3,bonus:{grit:2,presence:1},property:'warding',flavour:'A crown for someone who has already won.'},
  'Cinder Wyrm Fang':{damage:1.6,bonus:{brawn:1,reflex:1},property:'swift',flavour:'A tooth as long as a forearm, and twice as eager.'},
  'Mantle of the Ashen King':{armor:1.45,bonus:{grit:2},property:'warding',flavour:'Ash drifts from its hem and never reaches the floor.'},
  "Vesk's Phylactery Shard":{bonus:{wits:2,grit:1},property:'swift',flavour:'A sliver of a lich that wanted to be remembered.'},
  "Drowned King's Signet":{bonus:{presence:2,insight:1},property:'warding',flavour:'Still wet, no matter how long it is worn.'},
  'Cryptbound Greaves':{armor:1.1,bonus:{grit:1},property:'swift',flavour:'Made to stand a long vigil, and to leave it quickly.'},
  'Staff of Still Water':{damage:1.4,bonus:{wits:1,insight:1},property:'swift',flavour:'Not a ripple on it, even in the middle of a fight.'}};

// ---- inventory (issue #124) ----
// A hero's pack (a.inv, sim/inv.js) holds stacks: trade goods, consumables, quest items, and spare gear
// (an item object with a slot). Gold is kept apart. One slot per stack or spare piece.
export const INV={
  BASE:16,         // slots in a plain pack
  STACK:20,        // units in one stack
  KEEP_SPARES:2,   // too-high spares kept past a town sale (until the hero grows into them)
  WEAR_OVER:5,     // gear may be worn this many item levels above the hero's level
  POT_CD:6,        // seconds between potions in a fight (one shared cooldown per hero)
  POT_AT:.4,       // drink below this share of max HP in a fight (scaled by the flee trait)
  BANDAGE_AT:.6,   // bind wounds in the field below this share of max HP
  DROP_RATE:.05,   // consumable drop per ordinary kill; named elites always drop a potion
  WARD_SECS:40};   // how long a warding scroll holds
// Consumables, one row each: what they do (the tooltip prints these numbers), what they cost in town,
// the hero level that buys them and the weight for loot drops. kind: potion (heal in a fight),
// bandage (heal out of one), ration and torch (used at camp), antidote (cures venom), scroll
// (effect: recall | ward), pack (more slots).
export const USES={
  'Redroot Draught':   {kind:'potion', heal:.35,price:8, lvl:1, tier:1,drop:10,flavour:'Bitter, red, and quick. The herbwives of the Thornvale roads swear by it.'},
  'Marrowmend Tonic':  {kind:'potion', heal:.55,price:26,lvl:10,tier:2,drop:10,flavour:'Brewed from hearthbloom and cold-water silt; it knits what a blade has parted.'},
  'Linen Bandage':     {kind:'bandage',heal:.2, price:3, lvl:1, drop:6, flavour:'Boiled linen, tightly rolled. Useless in the middle of a fight, a mercy after one.'},
  'Trail Ration':      {kind:'ration', heal:.2, price:3, lvl:1, drop:3, flavour:'Hard bread, smoked meat and a pinch of salt. A camp supper that mends a little.'},
  'Pitch Torch':       {kind:'torch',  watch:3,price:3, lvl:1, drop:2, flavour:'Burns the night back from the camp; whoever keeps the watch sees farther.'},
  'Bogroot Antidote':  {kind:'antidote',price:8, lvl:3, drop:2, flavour:'A grey paste that draws venom and rot out of a wound.'},
  'Scroll of Hearthward':{kind:'scroll',effect:'recall',price:25,lvl:4,drop:.5,flavour:'Read aloud, it pulls the reader to their home gate in one breath.'},
  'Scroll of the Steadfast Hour':{kind:'scroll',effect:'ward',ward:.25,price:22,lvl:6,drop:.5,flavour:'A short-lived ward; blows land softer while the ink holds.'},
  "Wayfarer's Pack":   {kind:'pack',  slots:8,price:60,lvl:5,drop:0,flavour:'Stitched leather with a frame of ash. Carries what two ordinary packs would.'}};
// What a consumable does, as tooltip lines [css, text] (src/ui/panels.js prints them like gear stats).
export function useLines(id){const U=USES[id],o=[];if(!U)return o;
  if(U.heal)o.push(['ar','Heals '+Math.round(U.heal*100)+'% of max health'+(U.kind==='bandage'?', out of combat':U.kind==='ration'?', at camp':'')]);
  if(U.kind==='potion')o.push(['dg','Usable in a fight; one every '+INV.POT_CD+' s']);
  if(U.kind==='torch')o.push(['bn',"Camp: the watcher's Perception check is "+U.watch+' easier']);
  if(U.kind==='antidote')o.push(['bn','Cures venom and rot']);
  if(U.effect==='recall')o.push(['bn','Carries the reader to their home gate']);
  if(U.effect==='ward')o.push(['pr','Blows taken -'+Math.round(U.ward*100)+'% for '+INV.WARD_SECS+' s']);
  if(U.kind==='pack')o.push(['bn','+'+U.slots+' pack slots (one pack)']);
  if(U.lvl>1)o.push(['dm','Sold from level '+U.lvl]);
  return o}
// Quest items the DM's hand can place (sim/levers.js give_token). Adventures also hand out their own
// carried object under its job text ("a sealed letter"); those have no row here. Never sold, never given.
export const QUEST_ITEMS={
  'Rookscar Toll-Token':{flavour:'A bent copper disc stamped with a rook. Toll-crews wave a bearer through.'},
  'Chapel Tithe-Seal':{flavour:'A wax seal for a tithe box that has not yet been found.'},
  'Cairn-Door Key':{flavour:'Cold iron, notched twice. It fits no lock in any town.'},
  'Shrine Candle-Stub':{flavour:'Lit once at a wayside shrine; the wick still remembers.'}};

