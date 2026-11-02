// Class abilities (issue #81): the active moves and passives of every class, as data. Owned by
// character-builder; the one resolver is sim/moves.js, used by real-time combat today and by the
// round-by-round Table combat later. Names are original and recorded in docs/LORE.md under
// "Class abilities". (src/data/abilities.js holds the six ability SCORES and the skills; these are
// the combat "moves", so the file and tables are called moves to keep the two apart.)
//
// MOVES row:
//   name, cls          display name and owning class
//   kind               attack | heal | buff | control | defend | move
//   lvl                level it is learned at
//   cd / rounds        cooldown in seconds (real-time sim) and in rounds (Table combat)
//   cost               {hp: share of max HP} paid on use, or null
//   target             foe | foes (every engaged foe near you) | ally | allies | self
//   range              tiles to the target ('weapon' = the class's attack range); allies/foes: the radius
//   swing              true: the move takes the place of a weapon blow (waits for the swing timer)
//   fx                 what it does (see sim/moves.js resolve): dmg (x attack), crit (+chance), delay (seconds the
//                      foe loses before its next blow), taunt, taken (damage-taken multiplier), mark (damage-taken
//                      multiplier on the foe), heal {base, lvl, hp} (flat + per level + share of max HP), blink
//                      (tiles), shake (foes targeting you lose their aim: delay)
//   dur / durR         how long a timed effect holds, in seconds / in rounds
//   save               {abil, stat}: the foe rolls d20 + its modifier in `abil` against 8 + your `stat` modifier + training;
//                      on a save the delay is halved and a mark or snare does not take hold
//   use                the scripted policy tag (sim/moves.js pickMove) — when the scripted AI reaches for it
//   desc               one sentence for tooltips and agents
export const MOVES={
  // ---- Warrior: the one who stands in front ----
  challenge:{name:'Challenge',cls:'Warrior',kind:'control',lvl:1,cd:18,rounds:3,cost:null,target:'foe',range:6,swing:false,
    fx:{taunt:true},use:'taunt',desc:'Bellow a foe onto yourself: a monster fighting someone else turns on you.'},
  bastion:{name:'Bastion',cls:'Warrior',kind:'defend',lvl:4,cd:40,rounds:5,cost:null,target:'self',range:0,swing:false,
    fx:{taken:.6},dur:6,durR:2,use:'selfhurt',desc:'Plant your feet behind the shield: blows on you land at 60% for six seconds.'},
  recklessblow:{name:'Reckless Blow',cls:'Warrior',kind:'attack',lvl:7,cd:12,rounds:2,cost:{hp:.05},target:'foe',range:'weapon',swing:true,
    fx:{dmg:1.9},use:'burst',desc:'A swing with the whole body behind it: 190% damage, and it costs 5% of your health.'},
  // ---- Mage: ranged burst and control ----
  runelance:{name:'Rune Lance',cls:'Mage',kind:'attack',lvl:1,cd:10,rounds:2,cost:null,target:'foe',range:'weapon',swing:true,
    fx:{dmg:2},use:'burst',desc:'Write a rune in the air and throw it: 200% damage.'},
  rimering:{name:'Rime Ring',cls:'Mage',kind:'control',lvl:3,cd:22,rounds:3,cost:null,target:'foes',range:3,swing:false,
    fx:{dmg:.6,delay:2.5},save:{abil:'grit',stat:'wits'},use:'crowd',desc:'A ring of frost bursts around you: every foe nearby takes 60% damage and loses 2.5 seconds before its next blow (half on a save).'},
  flicker:{name:'Flicker Step',cls:'Mage',kind:'move',lvl:6,cd:26,rounds:4,cost:null,target:'self',range:0,swing:false,
    fx:{blink:3.5,delay:1.5},use:'pressed',desc:'Step through the seam of the air a few tiles away from the fight; the foe loses 1.5 seconds finding you.'},
  // ---- Hunter: marks, snares and the long shot ----
  deadeye:{name:'Dead-Eye Shot',cls:'Hunter',kind:'attack',lvl:1,cd:11,rounds:2,cost:null,target:'foe',range:'weapon',swing:true,
    fx:{dmg:1.8,crit:.3},use:'burst',desc:'Breathe out and loose one careful shot: 180% damage with a 30% better chance to crit.'},
  snare:{name:'Gorse Snare',cls:'Hunter',kind:'control',lvl:3,cd:24,rounds:4,cost:null,target:'foe',range:'weapon',swing:false,
    fx:{dmg:.4,delay:3.5},save:{abil:'reflex',stat:'insight'},use:'snare',desc:'A noose of thorn-cord where the foe will step: 40% damage and it loses 3.5 seconds before its next blow (half on a save).'},
  quarrymark:{name:'Quarry Mark',cls:'Hunter',kind:'control',lvl:6,cd:20,rounds:3,cost:null,target:'foe',range:'weapon',swing:false,
    fx:{mark:1.25},dur:8,durR:2,save:{abil:'insight',stat:'insight'},use:'mark',desc:'Name the quarry: for eight seconds every blow that lands on it, from anyone, does 25% more.'},
  // ---- Priest: wards and mending ----
  dawnward:{name:'Ward of Dawn',cls:'Priest',kind:'defend',lvl:2,cd:20,rounds:3,cost:null,target:'ally',range:4,swing:false,
    fx:{taken:.7},dur:8,durR:2,use:'wardally',desc:'Lay a warm light on a friend (or yourself): blows on them land at 70% for eight seconds.'},
  searingword:{name:'Searing Word',cls:'Priest',kind:'attack',lvl:4,cd:13,rounds:2,cost:null,target:'foe',range:'weapon',swing:true,
    fx:{dmg:1.7,delay:.8},use:'burst',desc:'A word the dark cannot stand: 170% damage, and the foe flinches for 0.8 seconds.'},
  chorus:{name:'Chorus of Mending',cls:'Priest',kind:'heal',lvl:6,cd:34,rounds:6,cost:null,target:'allies',range:5,swing:false,
    fx:{heal:{base:8,lvl:2.5,hp:.04}},use:'masshurt',desc:'A hymn that knits every friend within five tiles: 8 + 2.5 per level + 4% of their health.'},
  // ---- Rogue: the opener and the vanishing ----
  ambush:{name:'Ambush',cls:'Rogue',kind:'attack',lvl:1,cd:18,rounds:4,cost:null,target:'foe',range:'weapon',swing:true,
    fx:{dmg:2.8},use:'opener',desc:'The first blow on a fresh, unhurt foe: 280% damage.'},
  sinewcut:{name:'Sinew Cut',cls:'Rogue',kind:'attack',lvl:3,cd:11,rounds:2,cost:null,target:'foe',range:'weapon',swing:true,
    fx:{dmg:1,delay:2.5},save:{abil:'grit',stat:'wits'},use:'burst',desc:'A cut at the tendon: normal damage, and the foe loses 2.5 seconds before its next blow (half on a save).'},
  smokeveil:{name:'Smoke Veil',cls:'Rogue',kind:'defend',lvl:5,cd:36,rounds:5,cost:null,target:'self',range:0,swing:false,
    fx:{taken:.5,shake:2.5},dur:4,durR:1,use:'selfhurt',desc:'A pinch of powder and the room is smoke: foes on you lose 2.5 seconds, and blows land at half for four.'},
  // ---- Specialisations (issue #82): one extra ability per path, learned at level 10 with the path (spec:<id>) ----
  wardencover:{name:'Shield Cover',cls:'Warrior',spec:'warden',kind:'defend',lvl:10,cd:24,rounds:4,cost:null,target:'ally',range:4,swing:false,
    fx:{taken:.55},dur:6,durR:2,use:'wardally',desc:'Step in front of a friend and lift the shield: blows on them land at 55% for six seconds.'},
  reavercleave:{name:'Cleaving Sweep',cls:'Warrior',spec:'reaver',kind:'attack',lvl:10,cd:20,rounds:3,cost:null,target:'foes',range:2.2,swing:false,
    fx:{dmg:.9},use:'crowd',desc:'A wide sweep that bites every foe at your side: 90% damage to each.'},
  twinlance:{name:'Twin Lance',cls:'Mage',spec:'runescribe',kind:'attack',lvl:10,cd:14,rounds:2,cost:null,target:'foe',range:'weapon',swing:true,
    fx:{dmg:1.5,crit:.2},use:'burst',desc:'Two runes thrown as one: 150% damage and a 20% better chance to crit.'},
  winterhold:{name:"Winter's Hold",cls:'Mage',spec:'rimekeeper',kind:'control',lvl:10,cd:26,rounds:4,cost:null,target:'foe',range:'weapon',swing:false,
    fx:{dmg:.3,delay:5},save:{abil:'grit',stat:'wits'},use:'snare',desc:'The cold closes on one foe: 30% damage and it loses 5 seconds before its next blow (half on a save).'},
  heartseeker:{name:'Heartseeker',cls:'Hunter',spec:'stalker',kind:'attack',lvl:10,cd:20,rounds:3,cost:null,target:'foe',range:'weapon',swing:true,
    fx:{dmg:2.4,crit:.2},use:'burst',desc:'One arrow, all the patience: 240% damage with a 20% better chance to crit.'},
  thornfield:{name:'Thornfield',cls:'Hunter',spec:'trapper',kind:'control',lvl:10,cd:28,rounds:4,cost:null,target:'foes',range:3.5,swing:false,
    fx:{dmg:.5,delay:3},save:{abil:'reflex',stat:'insight'},use:'crowd',desc:'Cords and thorn across the whole pack: every foe nearby takes 50% damage and loses 3 seconds (half on a save).'},
  dawnbrand:{name:'Dawnbrand',cls:'Priest',spec:'battlecleric',kind:'attack',lvl:10,cd:16,rounds:2,cost:null,target:'foe',range:'weapon',swing:true,
    fx:{dmg:2.1,delay:1.2},use:'burst',desc:'The faith made a hammer: 210% damage, and the foe reels for 1.2 seconds.'},
  mendingtouch:{name:'Mending Touch',cls:'Priest',spec:'mender',kind:'heal',lvl:10,cd:12,rounds:2,cost:null,target:'ally',range:5,swing:false,
    fx:{heal:{base:18,lvl:4,hp:.1}},use:'healally',desc:'A hand on one hurt friend: 18 + 4 per level + 10% of their health.'},
  backstab:{name:'Backstab',cls:'Rogue',spec:'cutthroat',kind:'attack',lvl:10,cd:14,rounds:2,cost:null,target:'foe',range:'weapon',swing:true,
    fx:{dmg:2.2,crit:.3},use:'burst',desc:'The blade goes where the armour does not: 220% damage and a 30% better chance to crit.'},
  dirtytrick:{name:'Dirty Trick',cls:'Rogue',spec:'trickster',kind:'control',lvl:10,cd:22,rounds:3,cost:null,target:'foe',range:'weapon',swing:false,
    fx:{delay:3,mark:1.2},dur:8,durR:2,save:{abil:'insight',stat:'wits'},use:'mark',desc:'Sand, a feint, a shout: the foe loses 3 seconds and, for eight, every blow on it does 20% more (a save resists both).'},
};

// Passives: always on from the level they are learned at. Keys (read by sim/stats.js and sim/moves.js):
//   crit (+chance), defense (+share turned aside), health (+share of Health), takenBelow {hp, mul}
//   (blows land at mul once your HP share is under hp), taken (blows land at mul), healMul (healing done),
//   openerMul (the first blow on a foe above 95% health).
export const PASSIVES={
  unbowed:{name:'Unbowed',cls:'Warrior',lvl:4,takenBelow:{hp:.35,mul:.8},desc:'Under 35% health, blows on you land at 80%.'},
  stoutheart:{name:'Stout Heart',cls:'Warrior',lvl:8,health:.06,desc:'+6% Health.'},
  runememory:{name:'Rune Memory',cls:'Mage',lvl:3,crit:.06,desc:'+6% Crit: the second casting of any rune is cleaner.'},
  openingrune:{name:'Opening Rune',cls:'Mage',lvl:6,openerMul:1.3,desc:'The first blow on an unhurt foe does 30% more.'},
  hawkeyed:{name:'Hawk-Eyed',cls:'Hunter',lvl:2,crit:.05,desc:'+5% Crit.'},
  trailwise:{name:'Trail-Wise',cls:'Hunter',lvl:7,defense:.04,desc:'+4% Defense: you know where the ground will hold.'},
  gentlehands:{name:'Gentle Hands',cls:'Priest',lvl:1,healMul:1.15,desc:'Healing done +15%.'},
  sanctuary:{name:'Sanctuary',cls:'Priest',lvl:8,takenBelow:{hp:.5,mul:.9},desc:'Under half health, blows on you land at 90%.'},
  knifehand:{name:'Knife-Hand',cls:'Rogue',lvl:3,crit:.06,desc:'+6% Crit.'},
  slipblow:{name:'Slip the Blow',cls:'Rogue',lvl:6,taken:.95,desc:'Blows on you land at 95%: you are seldom where the weapon thought.'},
  // ---- Specialisation passives (issue #82), learned with the path at level 10 ----
  wardenvow:{name:"Warden's Vow",cls:'Warrior',spec:'warden',lvl:10,defense:.05,health:.04,desc:'+5% Defense and +4% Health.'},
  reaverfury:{name:"Reaver's Fury",cls:'Warrior',spec:'reaver',lvl:10,crit:.05,openerMul:1.15,desc:'+5% Crit; the first blow on an unhurt foe does 15% more.'},
  greatrunes:{name:'Great Runes',cls:'Mage',spec:'runescribe',lvl:10,crit:.05,openerMul:1.2,desc:'+5% Crit; the first blow on an unhurt foe does 20% more.'},
  frostbound:{name:'Frostbound',cls:'Mage',spec:'rimekeeper',lvl:10,defense:.04,health:.06,desc:'+4% Defense and +6% Health: the cold is on your side.'},
  steadyaim:{name:'Steady Aim',cls:'Hunter',spec:'stalker',lvl:10,crit:.07,desc:'+7% Crit.'},
  groundlore:{name:'Ground-Lore',cls:'Hunter',spec:'trapper',lvl:10,defense:.04,taken:.96,desc:'+4% Defense and blows on you land at 96%.'},
  zeal:{name:'Zeal',cls:'Priest',spec:'battlecleric',lvl:10,health:.06,crit:.04,desc:'+6% Health and +4% Crit.'},
  tenderness:{name:'Tenderness',cls:'Priest',spec:'mender',lvl:10,healMul:1.2,desc:'Healing done +20%.'},
  deadlyopening:{name:'Deadly Opening',cls:'Rogue',spec:'cutthroat',lvl:10,crit:.04,openerMul:1.25,desc:'+4% Crit; the first blow on an unhurt foe does 25% more.'},
  nimble:{name:'Nimble',cls:'Rogue',spec:'trickster',lvl:10,taken:.92,desc:'Blows on you land at 92%.'},
};

// Per class, in the order a policy considers them (first ready and wanted wins).
export const CLASS_MOVES={};
export const CLASS_PASSIVES={};
// Specialisation rows (spec:<id>, issue #82) are kept apart so the base class lists stay at three and two.
export const SPEC_MOVES={},SPEC_PASSIVES={};
for(const id in MOVES){const M=MOVES[id];if(M.spec){(SPEC_MOVES[M.spec]||(SPEC_MOVES[M.spec]=[])).push(id);continue}(CLASS_MOVES[M.cls]||(CLASS_MOVES[M.cls]=[])).push(id)}
for(const id in PASSIVES){const P=PASSIVES[id];if(P.spec){(SPEC_PASSIVES[P.spec]||(SPEC_PASSIVES[P.spec]=[])).push(id);continue}(CLASS_PASSIVES[P.cls]||(CLASS_PASSIVES[P.cls]=[])).push(id)}
export const KINDS=['attack','heal','buff','control','defend','move'];
// Tooltip colour per kind (ui/abilities.js).
export const KIND_COLOR={attack:'#ff8a5a',heal:'#7dce5a',buff:'#f2c14e',control:'#9ad0ff',defend:'#c8c8e0',move:'#c58cff'};
