// World specs: the world described as data. `src/world/gen.js` turns a spec
// into tiles, zones, towns, landmarks, roads, spawn points, lights and labels.
// Pure data, no logic. Owned by world-builder.
//
// Shape of a spec:
//   size      {w,h} in tiles. tiles.js takes W,H from the active spec (see WORLD_ID below).
//   seeds     {terrain, detail} fbm seeds for the two biome noise fields.
//   curves    named boundary curves. `axis:'y'` gives an x threshold per row
//             (a north-south line that wanders), `axis:'x'` a y threshold per
//             column. value = base + round(sum of sin terms + noise term):
//               sin:[[period,amp,phase], ...]      amp*sin(t/period+phase)
//               noise:{seed,scale,amp,slice}        (vnoise(..)-.5)*amp sampled at t/scale
//   regions   ordered; later regions override earlier ones where masks overlap.
//             {id, name, band:[minLvl,maxLvl], biome, mask}
//             biome: 'meadow' | 'fen' | 'ash' | 'tundra' | 'highland' (painters live in gen.js)
//             mask kinds: 'all' | 'rect'{x0,y0,x1,y1} | 'west-of-curve' |
//               'east-of-curve' | 'north-of-curve' | 'south-of-curve' (curve: name) |
//               'and'{masks} | 'or'{masks} | 'not'{mask}
//   river     {curve, width, fords?} painted as RIVER along the curve; roads bridge it. fords: places along it (y on a north-south river) left walkable.
//   towns     {name, fac, x0, y0, w, h, gate:'E'|'W'|'N'|'S', race, spots, npcs}
//             WALL border, FLOOR inside, two gate tiles in the middle of the gate
//             wall; gate point and graveyard are derived from the rect by gen.js.
//             wall: (optional) the wall set drawn instead of the town style's own ('palisade'), art only;
//             buildings: (optional) [{piece, box:[x,y,w,h], door:[x,y], serves, kit}] in world tiles;
//             missing, gen.js lays out the town plan of data/townart.js TOWN_PIECES: each
//             building is solid except its one door tile, and the spot it `serves` is that door.
//             spots: interior points as [dx,dy] offsets from x0,y0 where the
//             townsfolk keep their posts: quartermaster (the auction house, the
//             heroes' `ah` stop), gate (the gate captain, the quest-giver `qg`
//             stop), inn, smith, chapel, square. Missing spots get defaults laid
//             out relative to the gate side (sim/npcs.js, data/npcs.js); a spot
//             that a building serves stands at its door instead.
//             npcs: role ids staffed here (default: every role in data/npcs.js).
//   outposts  {id, name, x, y, r} contested outposts (#11): data only, never painted; sim/outposts.js owns who holds them.
//   landmarks {kind:'lair', name, x, y, r, inner, mouth:'W'|'E'|'N'|'S', exclude, light}
//             {kind:'crypt', name, boss, x, y, mouth:{x0,y0,w,h}, exclude, cd, rooms, entry}
//             every crypt is a dungeon a group can enter (#891); entry: the level the background calls up for it (default 7)
//             rooms (#65, optional): the dungeon's chambers in order, played room by room at the Table by
//             the Fellowship (sim/crawl.js; background groups keep the one abstract roll). Each room:
//             {id, name, frame, foes:[{type, n, name?, hits?, atk?}], lvl (foe level offset from the
//             party's average), hit (share of a hero's max HP a foe's blow takes), rounds (rounds
//             before the party is driven back)}. type is a bestiary key (data/bestiary.js).
//   points    named waypoints that roads may reference.
//   roads     either a polyline [[x,y],...] painted as-is, or
//             {from, to, via:[...]} where endpoints are town names (their gate),
//             landmark names or point names, routed with A* over tile cost.
//   lights    {townTorches:[[dx,dy],...]} offsets from each town's x0,y0.
//   spawn     {townPad:[px,py]} tiles around a town rect that are never spawn points.
//   nodes     (#255) gathering nodes, placed by world/nodes.js: {respawn:{herb,ore,hide,fish: game minutes},
//             regions:{<region id>:{herb:n,ore:n,hide:n,fish:n}}}. A node's skill band comes from its region's level
//             band; fish stand on the shore of river water; nothing sits on roads, towns or landmarks.
//   labels    [['TEXT',x,y],...]; omitted => one per region and town, auto-placed.

// The danger of the stair, made readable in the world (#448): the game never refuses a descent for level. The sign is
// read on first sight of the stair (sim/lore.js visit), the captain says his piece to a green blade who talks to him.
const CRYPT_SIGN='A weathered sign is nailed to the stair-post, the paint nearly gone: "Those who went below were tried blades; you are not. Turn back."';
const CRYPT_CAPTAIN='The Sunken Crypt is not a place for green blades. Those who went down before you were tried, and the stair has kept more of them than the bards admit. Grow first, then go, and go together.';
// The Sunken Crypt's chambers, in the order the Fellowship meets them (sim/crawl.js). Bestiary species, no new creatures.
const CRYPT_ROOMS=[
  {id:'stair',name:'The Weeping Stair',frame:'Water runs down the steps of the stair and something small scuttles in the dark below.',
    foes:[{type:'tombskit',n:3}],lvl:-1,hit:.225,rounds:2},
  {id:'ossuary',name:'The Ossuary',frame:'Shelves of old bone line the walls. Some of it stands up as the light reaches it.',
    foes:[{type:'shambler',n:2}],lvl:0,hit:.29,rounds:2},
  {id:'gallery',name:"The Archers' Gallery",frame:'A long gallery with arrow-slits in every pillar. Dry bowstrings creak somewhere above.',
    foes:[{type:'boneshot',n:2,hits:1},{type:'shambler',n:1}],lvl:0,hit:.29,rounds:2},
  {id:'court',name:'The Drowned Court',frame:'The floor is a black mirror of still water. Grave Wardens stand in it to the knee, keeping a court that no longer sits.',
    foes:[{type:'graveward',n:2,hits:2}],lvl:1,hit:.38,rounds:2},
  {id:'vigil',name:'The Vigil Chamber',frame:'The last door. Something has kept watch here a very long time, and the cold has a voice. It knows every name in the party.',
    foes:[{type:'graveward',n:1,name:'Lich-Warden Vesk',hits:4,atk:1.6},{type:'tombskit',n:1}],lvl:2,hit:.43,rounds:2,boss:true},
];

export const ELDMOOR={
  name:'Eldmoor',
  size:{w:80,h:50},
  seeds:{terrain:11,detail:23},
  curves:{
    // The river: x≈26, two gentle sine wanders.
    river:{axis:'y',base:26,sin:[[5,1.6,0],[2.3,.7,1]]},
    // Mirefen / Cinderpass boundary: x≈53, noisy.
    passEdge:{axis:'y',base:53,noise:{seed:5,scale:4,amp:7,slice:3.3}},
    // Hoarfell's southern edge: y between 9 and 15 (never past 16, so Kragmaw's lair stays in Cinderpass).
    frostEdge:{axis:'x',base:12,noise:{seed:17,scale:4,amp:6,slice:2.7}},
  },
  regions:[
    {id:'thornvale',name:'Thornvale',band:[1,5],biome:'meadow',mask:{kind:'all'}},
    {id:'mirefen',name:'Mirefen',band:[6,10],biome:'fen',mask:{kind:'east-of-curve',curve:'river'}},
    {id:'cinderpass',name:'Cinderpass',band:[11,15],biome:'ash',mask:{kind:'east-of-curve',curve:'passEdge'}},
    {id:'hoarfell',name:'Hoarfell',band:[16,Infinity],biome:'tundra',
      mask:{kind:'and',masks:[{kind:'north-of-curve',curve:'frostEdge'},{kind:'east-of-curve',curve:'river'}]}},
  ],
  river:{curve:'river',width:2},
  towns:[
    // spots: the quartermaster, gate captain, smith, chapel and inn stand at the door of their building
    // (the town plan, gen.js planBuildings, #793); the square is in the middle of the hero path.
    // Homes line the back (west) wall at night.
    {name:'Highgate',fac:0,x0:2,y0:2,w:11,h:9,gate:'E',race:'hallowan',
      spots:{square:[5.5,6.1]}},
    {name:'Grimhold',fac:1,x0:2,y0:39,w:11,h:9,gate:'E',race:'ashfolk',
      spots:{square:[5.5,6.1]}},
  ],
  landmarks:[
    {kind:'lair',name:'Kragmaw',x:71.5,y:25.5,r:5.4,inner:4,mouth:'W',exclude:7.5,light:{big:1}},
    {kind:'crypt',name:'The Sunken Crypt',boss:'Lich-Warden Vesk',x:44.5,y:43.1,mouth:{x0:43,y0:41,w:3,h:3},exclude:3.5,cd:25,rooms:CRYPT_ROOMS,
      sign:CRYPT_SIGN,captain:CRYPT_CAPTAIN},
  ],
  // Contested outposts (#11): data only, nothing is painted (the map hash does not move). Whichever faction holds one
  // (sim/outposts.js) gets a rest aura around it; kills within r+2 count double honor. {id,name,x,y,r}; the region is read from the map.
  outposts:[
    {id:'fenmarch',name:'Fenmarch Cross',x:49.5,y:33.5,r:3.5},
    {id:'ashgate',name:'Ashgate Watch',x:57.5,y:25.5,r:3.5},
  ],
  points:{crossroads:[40,25]},
  roads:[
    [[13,6.5],[20,9],[29,17],[40,25]],        // Highgate to the crossroads
    [[13,43.5],[20,41],[29,33],[40,25]],      // Grimhold to the crossroads
    [[40,25],[50,23],[60,26],[67,25.4]],      // east to Kragmaw's lair
    [[40,25],[38,33],[44,43.4]],              // south to the Sunken Crypt
    [[40,25],[46,17],[52,8]],                 // north road into Hoarfell
  ],
  lights:{townTorches:[[10.5,3.4],[10.5,6.4],[4,3],[8,3]]},
  spawn:{townPad:[4,3]},
  nodes:{respawn:{herb:240,ore:480,hide:180,fish:120},regions:{
    thornvale:{herb:7,ore:4,hide:6,fish:5},mirefen:{herb:7,ore:4,hide:5,fish:5},
    cinderpass:{herb:3,ore:7,hide:5,fish:0},hoarfell:{herb:3,ore:5,hide:5,fish:2}}},
  labels:[['THORNVALE',14,24],['MIREFEN',38,19],['CINDERPASS',63,18],['HOARFELL',52,5],['HIGHGATE',7.5,1.4],['GRIMHOLD',7.5,49.2]],
};

// A tiny fixture used by scripts/worldcheck.mjs: one town, two regions, a river
// and roads given as endpoints so the A* router has to bridge the river.
// Not canon (see docs/LORE.md, "Test fixtures").
export const TESTWORLD={
  name:'Testworld',
  size:{w:40,h:30},
  curves:{
    brook:{axis:'y',base:18,sin:[[4,1.2,0]]},
  },
  regions:[
    {id:'lowmead',name:'Lowmead',band:[1,5],biome:'meadow',mask:{kind:'all'}},
    {id:'greyreach',name:'Greyreach',band:[6,10],biome:'fen',mask:{kind:'east-of-curve',curve:'brook'}},
  ],
  river:{curve:'brook',width:2},
  towns:[
    {name:'Wendmere',fac:0,x0:2,y0:10,w:11,h:9,gate:'E',race:null},
  ],
  landmarks:[
    {kind:'crypt',name:'The Barrow Gate',boss:'The Barrow Reeve',x:32.5,y:24.1,mouth:{x0:31,y0:22,w:3,h:3},exclude:3.5,cd:25},
  ],
  points:{crossroads:[26,15]},
  nodes:{respawn:{herb:60,ore:120,hide:60,fish:30},regions:{lowmead:{herb:3,ore:2,hide:2,fish:2},greyreach:{herb:3,ore:2,hide:2,fish:2}}},
  roads:[
    {from:'Wendmere',to:'crossroads'},
    {from:'crossroads',to:'The Barrow Gate'},
  ],
  lights:{townTorches:[[10.5,3.4],[10.5,6.4],[4,3],[8,3]]},
  spawn:{townPad:[4,3]},
};

// ---- The Stepping Lands: a 160x100 test continent (issue #36, scaling phase 5) ----
// Four times the area of Eldmoor: two home towns per faction, six regions on a ladder of
// overlapping level bands (1-5, 4-9, 8-13, 12-16, 15-19, 18-22), the Sunken Crypt and Kragmaw
// kept, and a placeholder second dungeon. Where bands overlap, zoneFor(level, home) sends a
// hero to the region nearest their home town, so northern and southern towns climb different
// ways. Not canon geography: see docs/LORE.md, "The Stepping Lands". Region fauna lives in
// src/data/fauna.js, keyed by region id.
const TOWN_SPOTS={square:[5.5,6.1]}; // the others stand at their building's door (gen.js planBuildings, #793)
// The Stepping Lands' Sunken Crypt (#309): three chambers of its own, pitched for Sedgewater (levels 4-9; offsets are
// from the party's average). Bestiary species only; the boss is a Grave Warden under a name, not a new creature.
const STEPPING_CRYPT_ROOMS=[
  {id:'sump',name:'The Reed Sump',frame:'The crypt stair ends in a flooded sump choked with dead reeds. Something small and many-legged moves under the water-mat.',
    foes:[{type:'tombskit',n:3}],lvl:-1,hit:.225,rounds:2},
  {id:'bonehall',name:'The Salt-Bone Hall',frame:'Fen salt has crusted the old shelves white. The bones under it are not as still as they should be, and a dry bowstring creaks in the dark.',
    foes:[{type:'shambler',n:1},{type:'boneshot',n:1,hits:1}],lvl:0,hit:.27,rounds:2},
  {id:'mere',name:"The Mere-Warden's Seat",frame:'The last chamber is a round pool with a stone chair standing in it. The one who sits there has watched the fen rise for a very long time.',
    foes:[{type:'graveward',n:1,name:'Mere-Warden Hask',hits:3,atk:1.5},{type:'tombskit',n:1}],lvl:1,hit:.36,rounds:2,boss:true},
];

// The Hollow Cairn's chambers (#717): four, pitched for Cairnwold (levels 8-13; offsets from the party's average).
// Bestiary species only; the boss is a Grave Warden under the name the spec already reserved, and its six blows get four rounds (#891: reflex parties clear about 60%, at three 18%). The rooms are data on the
// landmark, and every crypt landmark is a dungeon of its own (sim/crypts.js, #891).
const CAIRN_ROOMS=[
  {id:'throat',name:'The Cold Throat',frame:'The hill opens into a low passage of fitted stones, breathing out cold. Small legs click along the walls ahead of the light.',
    foes:[{type:'tombskit',n:4}],lvl:-1,hit:.23,rounds:2},
  {id:'ringhall',name:'The Ring of Heaped Stones',frame:'A round hall where every burial has been heaped to the height of a man. The heaps shift, and a dry bowstring creaks from the dark between them.',
    foes:[{type:'shambler',n:2},{type:'boneshot',n:1,hits:1}],lvl:0,hit:.29,rounds:2},
  {id:'lamps',name:'The Hall of Unlit Lamps',frame:'Rows of stone lamps, every wick long dead. Archers stand among them, and something old and patient watches from behind the last row.',
    foes:[{type:'boneshot',n:2,hits:1},{type:'graveward',n:1,hits:2}],lvl:1,hit:.34,rounds:2},
  {id:'warden',name:"The Cairn-Warden's Door",frame:'The last chamber is closed by one great slab, and it stands open. The Warden within has kept the door against everyone, the living and the dead, and knows the weight of every name.',
    foes:[{type:'graveward',n:1,name:'The Cairn-Warden',hits:4,atk:1.6},{type:'shambler',n:1}],lvl:2,hit:.42,rounds:4,boss:true},
];

export const STEPPING={
  name:'Stepping Lands',
  size:{w:160,h:100},
  seeds:{terrain:37,detail:61},
  curves:{
    // The Greywater: the western river, x≈46.
    river:{axis:'y',base:46,sin:[[6,1.8,0],[2.6,.7,1]]},
    // Cairnwold / Cinderreach boundary: x≈104, noisy.
    cinderEdge:{axis:'y',base:104,noise:{seed:9,scale:5,amp:10,slice:4.1}},
    // The Pale boundary: x≈132, noisy. Splits the northern tundra into two regions.
    paleEdge:{axis:'y',base:132,noise:{seed:21,scale:5,amp:8,slice:6.3}},
    // The frost line: y≈36, the southern edge of the highland and the tundra.
    frostLine:{axis:'x',base:36,noise:{seed:17,scale:5,amp:8,slice:2.7}},
  },
  regions:[
    {id:'lowmark',name:'Lowmark',band:[1,5],biome:'meadow',mask:{kind:'all'}},
    {id:'sedgewater',name:'Sedgewater',band:[4,9],biome:'fen',mask:{kind:'east-of-curve',curve:'river'}},
    {id:'cairnwold',name:'Cairnwold',band:[8,13],biome:'highland',
      mask:{kind:'and',masks:[{kind:'east-of-curve',curve:'river'},{kind:'west-of-curve',curve:'cinderEdge'},{kind:'north-of-curve',curve:'frostLine'}]}},
    {id:'cinderreach',name:'Cinderreach',band:[12,16],biome:'ash',mask:{kind:'east-of-curve',curve:'cinderEdge'}},
    {id:'rimeholt',name:'Rimeholt',band:[15,19],biome:'tundra',
      sky:[['clear',.45],['snow',.2],['squall',.35]], // squalls off the ridge
      mask:{kind:'and',masks:[{kind:'east-of-curve',curve:'cinderEdge'},{kind:'west-of-curve',curve:'paleEdge'},{kind:'north-of-curve',curve:'frostLine'}]}},
    {id:'palereach',name:'Palereach',band:[18,22],biome:'tundra',far:true,
      sky:[['clear',.5],['fog',.35],['snow',.15]], // fog-bound far north
      mask:{kind:'and',masks:[{kind:'east-of-curve',curve:'paleEdge'},{kind:'north-of-curve',curve:'frostLine'}]}},
  ],
  river:{curve:'river',width:2,fords:[72]}, // the one bridge is far north; the south wades here (#794)
  towns:[
    {name:'Highgate',fac:0,x0:2,y0:2,w:11,h:9,gate:'E',race:'hallowan',spots:TOWN_SPOTS},
    {name:'Grimhold',fac:1,x0:2,y0:87,w:11,h:9,gate:'E',race:'ashfolk',spots:TOWN_SPOTS},
    {name:'Cairnmoot',fac:0,x0:28,y0:30,w:11,h:9,gate:'E',race:'tarrow',spots:TOWN_SPOTS},
    {name:'Murkstead',fac:1,x0:28,y0:62,w:11,h:9,gate:'E',race:'mirekin',spots:TOWN_SPOTS},
    // #715: homes for the Skerrin (Concord) and the Thornhide (Warband), appended.
    {name:'Brinereach',fac:0,x0:30,y0:46,w:11,h:9,gate:'E',race:'skerrin',spots:TOWN_SPOTS},
    {name:'Thornteeth',fac:1,x0:52,y0:74,w:11,h:9,gate:'E',race:'thornhide',spots:TOWN_SPOTS},
  ],
  landmarks:[
    {kind:'crypt',name:'The Sunken Crypt',boss:'Mere-Warden Hask',x:72.5,y:86.1,mouth:{x0:71,y0:84,w:3,h:3},exclude:3.5,cd:25,rooms:STEPPING_CRYPT_ROOMS,
      sign:CRYPT_SIGN,captain:CRYPT_CAPTAIN},
    {kind:'lair',name:'Kragmaw',x:140.5,y:66.5,r:5.4,inner:4,mouth:'W',exclude:7.5,light:{big:1}},
    // The second dungeon (#717): its chambers and boss are data here; see LORE.md.
    {kind:'crypt',name:'The Hollow Cairn',boss:'The Cairn-Warden',x:84.5,y:14.1,mouth:{x0:83,y0:12,w:3,h:3},exclude:3.5,cd:25,rooms:CAIRN_ROOMS,entry:10},
  ],
  points:{hubW:[58,46],hubE:[104,52],lairGate:[134,66],frostGate:[116,24],paleGate:[146,22]},
  roads:[
    {from:'Highgate',to:'Cairnmoot'},
    {from:'Cairnmoot',to:'hubW'},
    {from:'Grimhold',to:'Murkstead'},
    {from:'Murkstead',to:'hubW'},
    {from:'Brinereach',to:'hubW'},
    {from:'Thornteeth',to:'Murkstead'},
    {from:'Thornteeth',to:'The Sunken Crypt'},
    {from:'hubW',to:'The Sunken Crypt'},
    {from:'hubW',to:'The Hollow Cairn'},
    {from:'hubW',to:'hubE'},
    {from:'hubE',to:'lairGate'},
    {from:'hubE',to:'frostGate'},
    {from:'frostGate',to:'paleGate'},
  ],
  lights:{townTorches:[[10.5,3.4],[10.5,6.4],[4,3],[8,3]]},
  // nearest: when picking a hunting point near a hero (or a home town), take the nearest of this
  // many random spawn points, so heroes stay local in regions too big for the Eldmoor 7-tile test.
  spawn:{townPad:[4,3],nearest:40},
  nodes:{respawn:{herb:240,ore:480,hide:180,fish:120},regions:{
    lowmark:{herb:16,ore:8,hide:12,fish:8},sedgewater:{herb:14,ore:8,hide:12,fish:5},cairnwold:{herb:12,ore:12,hide:10,fish:0},
    cinderreach:{herb:8,ore:14,hide:10,fish:0},rimeholt:{herb:8,ore:10,hide:10,fish:0},palereach:{herb:6,ore:8,hide:8,fish:0}}},
};

// ---- The Wending Vale: the third world (epic #940, slice A) ----
// 144x60, shaped for the owner's 3440x1440 screen (about 107x45 tiles at zoom 1, so the whole map shows with a small zoom-out).
// One river, the Wend, runs from a spring in the high north-east to the sea off the west edge; the Concord holds the north bank, the
// Warband the south. Six regions climb the river by its x (listed Wendmouth, Sallowfen, Greywood, Hawkwold, ... so that a company seasoned for the third region starts past the delves): Wendmouth (1-5) holds the first home towns, Sallowfen (south) and
// Hawkwold (north) face each other across the water (3-8), then Greywood (6-11), Ashenfold (10-15) and Rimecrown (14+). Every
// region sits next to ones whose low band is at most `ladder.step` above its own (#934: no company walks from its start into
// creatures far above it; scripts/worldcheck.mjs tests it from every home town). Three crossings carry all travel: the Low Bridge
// at the home towns, the Weirgate ford in the middle with the great dungeon beside it, and the High Bridge at the contested edge.
// Names in docs/LORE.md ("The Wending Vale"); creatures in data/fauna.js (a first pass by region id, creature-designer's to refine).
const VALE_WEIR_ROOMS=[
  {id:'sluice',name:'The Sluice Stair',frame:'A stair of green stone runs down beside the old sluice. Water chatters in the dark and something small and many-legged answers it.',
    foes:[{type:'tombskit',n:3}],lvl:-1,hit:.225,rounds:2},
  {id:'millrace',name:'The Millrace Gallery',frame:'The millrace still turns, driving nothing. Things the river gave up stand along the walls and begin to move.',
    foes:[{type:'shambler',n:2}],lvl:0,hit:.29,rounds:2},
  {id:'weighing',name:'The Weighing Hall',frame:'Great scales hang from the roof, tipped by what lies in the pans. Dry bowstrings creak from the beams.',
    foes:[{type:'boneshot',n:2,hits:1},{type:'shambler',n:1}],lvl:0,hit:.29,rounds:2},
  {id:'granary',name:'The Flooded Granary',frame:'Black water lies knee-deep between the grain bins. Wardens stand in it, still guarding a harvest that rotted a century ago.',
    foes:[{type:'graveward',n:2,hits:2}],lvl:1,hit:.38,rounds:3},
  {id:'chair',name:"The Weir-Warden's Chair",frame:"The last chamber is a round pool with the weir-keeper's chair standing in it. The one who sits there has held the river back a very long time.",
    foes:[{type:'graveward',n:1,name:'Weir-Warden Orsk',hits:4,atk:1.6},{type:'tombskit',n:1}],lvl:2,hit:.43,rounds:4,boss:true},
];
const VALE_KESTREL_ROOMS=[
  {id:'door',name:'The Low Door',frame:'A low door in a grassed mound, its lintel cut with kestrels. Cold air comes out of it, and the rattle of small claws.',
    foes:[{type:'tombskit',n:2}],lvl:-1,hit:.22,rounds:2},
  {id:'niches',name:'The Kestrel Niches',frame:'Every niche holds a stone bird and a heap of bone. One of the heaps gets up, still holding the lure-glove.',
    foes:[{type:'shambler',n:1},{type:'tombskit',n:1}],lvl:0,hit:.27,rounds:2},
  {id:'mews',name:"The Falconer's Mews",frame:'The last chamber is a mews with the perches still in it. The lord who bred the birds sits among them and does not intend to be disturbed.',
    foes:[{type:'shambler',n:1,name:'Lord Merrin Hawkwright',hits:3,atk:1.4},{type:'boneshot',n:1,hits:1}],lvl:1,hit:.32,rounds:3,boss:true},
];
const VALE_VAULT_ROOMS=[
  {id:'eel',name:'The Eel Cellar',frame:'Sunken cellars under a burnt kiln, the floor a foot deep in brown water. Fen-smugglers have made a guardroom of the first one.',
    foes:[{type:'reedcutter',n:2,hits:2}],lvl:-1,hit:.24,rounds:3},
  {id:'tally',name:'The Salt Tally',frame:'Barrels of grey salt and a tally-board scratched in charcoal. Two big men get up from the table and reach for their cudgels.',
    foes:[{type:'tollbreaker',n:2,hits:2}],lvl:0,hit:.29,rounds:3},
  {id:'cold',name:'The Cold Store',frame:'A vaulted cold-store, and the smuggler-captain who has made himself king of it. He counts you, and the count is not kind.',
    foes:[{type:'captain',n:1,name:'Captain Dane Sallow',hits:4,atk:1.4},{type:'hedgecaller',n:1,hits:1}],lvl:1,hit:.34,rounds:4,boss:true},
];
const VALE_KILN_ROOMS=[
  {id:'flue',name:'The Flue Gallery',frame:'Heat rolls up the great flue. Slag motes drift down it like sparks and gather on the stone.',
    foes:[{type:'slagmote',n:3}],lvl:-1,hit:.24,rounds:2},
  {id:'ash',name:'The Ash Floor',frame:'A floor of drifted ash, cooling, and the crawlers who live in it come up out of the drifts all at once.',
    foes:[{type:'cavecrawler',n:2,hits:1},{type:'golem',n:1,hits:2}],lvl:0,hit:.3,rounds:3},
  {id:'heart',name:'The Kiln Heart',frame:'The last firing-chamber, still red at the heart. What tends it was built to, and has never been told it can stop.',
    foes:[{type:'golem',n:1,name:'The Kiln-Warden',hits:5,atk:1.5},{type:'slagmote',n:1}],lvl:2,hit:.4,rounds:4,boss:true},
];
// Town plans for the Vale (epic #940 slice C). The LPC building kit (scripts/art/packcut-buildings.mjs, PR #914) cuts one art piece per
// style and piece, to the footprint and door the plans give it, so every Vale town keeps these shapes (TOWN_KIT: footprint in
// tiles, the door tile inside it, and `rise`, how many tiles of art stand over the tiles behind it, which must be the town wall or
// another building). What makes a town its own is where the pieces stand, the town's size, its gate side and its streets
// (`ground`, rects from the town's corner, laid as road). scripts/worldcheck.mjs holds the Vale to the kit.
//
// A row's key is the plan's `kit` and the art's name (building:lpc-<style>-<kit>): a piece may have rows of its own footprints beside the
// plain one (`piece` names it), and `house` is only such rows: a house is sim-solid art that serves nobody. These stay out of
// data/townart.js TOWN_PIECES, because planBuildings puts every row of that table in every town of a world without plans.
export const TOWN_KIT={auction:{foot:[3,2],door:[1,1],rise:1},smithy:{foot:[1,2],door:[0,1],rise:1},hall:{foot:[3,2],door:[1,1],rise:1},
  chapel:{foot:[1,2],door:[0,1],rise:2},board:{foot:[1,1],door:[0,0],rise:0},inn:{foot:[3,2],door:[1,0],rise:0},
  'house-cottage':{piece:'house',foot:[2,2],door:[0,1],rise:0}, // low, door on the left, on the street's south side or in a yard
  'house-croft':{piece:'house',foot:[2,2],door:[1,1],rise:0},   // the same footprint under wood shakes, door on the right
  'house-gable':{piece:'house',foot:[2,3],door:[0,2],rise:0},   // gable end to the street: three tiles deep, so a door of full height
  'house-row':{piece:'house',foot:[3,2],door:[1,1],rise:1},     // against the north wall, as tall as the halls beside it
  'inn-harbour':{piece:'inn',foot:[4,3],door:[2,2],rise:0},     // two storeys, its door on the south side
  'hall-long':{piece:'hall',foot:[5,2],door:[2,1],rise:1}};
const TOWN_SERVES={auction:'quartermaster',smithy:'smith',hall:'gate',chapel:'chapel',board:'gate',inn:'inn'};
// [kit, dx, dy] from the town's top-left corner -> the plan's buildings (hall first among 'gate' servers is not needed: the list order decides the gate captain's door).
function townPlan(x0,y0,list){return list.map(([kit,dx,dy])=>{const k=TOWN_KIT[kit],piece=k.piece||kit;
  return{piece,kit,box:[x0+dx,y0+dy,k.foot[0],k.foot[1]],door:[x0+dx+k.door[0],y0+dy+k.door[1]],serves:TOWN_SERVES[piece]||null}})}
export const VALE={
  name:'The Wending Vale',
  size:{w:144,h:60},
  seeds:{terrain:53,detail:77},
  // #934 / epic #940: no region next to a region whose low band is more than `step` levels above it, seen from any home town.
  ladder:{step:4},
  curves:{
    // The Wend: an east-west river with two gentle wanders (sin only, so the crossings below can name its row).
    river:{axis:'x',base:30,sin:[[13,3.4,0],[5.3,1.3,1]]},
    // The region edges, west to east: Wendmouth | Sallowfen and Hawkwold | Greywood | Ashenfold | Rimecrown.
    wEdge:{axis:'y',base:38,noise:{seed:3,scale:5,amp:6,slice:1.7}},
    mEdge:{axis:'y',base:75,noise:{seed:8,scale:5,amp:6,slice:2.9}},
    eEdge:{axis:'y',base:102,noise:{seed:13,scale:5,amp:5,slice:4.3}},
    fEdge:{axis:'y',base:122,noise:{seed:19,scale:5,amp:5,slice:5.1}},
  },
  regions:[
    {id:'wendmouth',name:'Wendmouth',band:[1,5],biome:'meadow',mask:{kind:'all'}},
    {id:'sallowfen',name:'Sallowfen',band:[3,8],biome:'fen',
      mask:{kind:'and',masks:[{kind:'east-of-curve',curve:'wEdge'},{kind:'west-of-curve',curve:'mEdge'},{kind:'south-of-curve',curve:'river'}]}},
    {id:'greywood',name:'Greywood',band:[6,11],biome:'meadow',
      mask:{kind:'and',masks:[{kind:'east-of-curve',curve:'mEdge'},{kind:'west-of-curve',curve:'eEdge'}]}},
    {id:'hawkwold',name:'Hawkwold',band:[3,8],biome:'highland',
      mask:{kind:'and',masks:[{kind:'east-of-curve',curve:'wEdge'},{kind:'west-of-curve',curve:'mEdge'},{kind:'north-of-curve',curve:'river'}]}},
    {id:'ashenfold',name:'Ashenfold',band:[10,15],biome:'ash',
      mask:{kind:'and',masks:[{kind:'east-of-curve',curve:'eEdge'},{kind:'west-of-curve',curve:'fEdge'}]}},
    {id:'rimecrown',name:'Rimecrown',band:[14,Infinity],biome:'tundra',
      sky:[['clear',.45],['snow',.2],['squall',.35]], // squalls off the crown
      mask:{kind:'east-of-curve',curve:'fEdge'}},
  ],
  river:{curve:'river',width:2,span:[0,121],fords:[76]}, // the Wend rises at x=122; the Weirgate ford is the only wading place
  towns:[
    // Concord, north bank
    // Aldermere: a market green at the river mouth; the forge and the halls front a paved lane, the inn on the green's west edge.
    {name:'Aldermere',fac:0,x0:4,y0:4,w:11,h:9,gate:'E',race:'hallowan',spots:{square:[5.5,6.1]},
      buildings:townPlan(4,4,[['auction',3,1],['smithy',1,1],['hall',7,1],['chapel',6,1],['board',9,3],['inn',2,5]]),
      ground:[[1,3,9,1],[5,4,5,2]]},
    // Gullstrand: a harbour. The gate faces the river; a street runs up from it to a lane under the halls, and a quay and jetty reach out south.
    {name:'Gullstrand',fac:0,x0:6,y0:17,w:13,h:9,gate:'S',race:'skerrin',spots:{square:[6.5,4.1]},
      buildings:townPlan(6,17,[['auction',8,1],['smithy',11,1],['hall',2,1],['chapel',1,1],['board',8,7],['inn-harbour',1,4],['house-row',5,1],['house-gable',8,4],['house-cottage',10,4]]),
      ground:[[1,3,11,1],[6,3,2,5],[6,9,2,3],[5,12,4,1]]},
    // Hawkstead: a ridge town on terraces: the chapel stands on the hall's shoulder, a stair climbs the middle.
    {name:'Hawkstead',fac:0,x0:52,y0:10,w:11,h:11,gate:'E',race:'tarrow',spots:{square:[5.5,5.1]},
      buildings:townPlan(52,10,[['smithy',1,1],['auction',3,1],['hall',7,1],['chapel',9,3],['inn',2,6],['board',6,8]]),
      ground:[[1,3,8,1],[1,5,9,1],[5,3,1,6]]},
    // Warband, south bank
    // Brandhold: a forge town. The gate is in the north wall and a straight street runs to the yard before the inn.
    {name:'Brandhold',fac:1,x0:6,y0:42,w:11,h:9,gate:'N',race:'ashfolk',spots:{square:[5.5,4.1]},
      buildings:townPlan(6,42,[['smithy',1,1],['hall',2,1],['auction',7,1],['chapel',9,3],['board',7,3],['inn',2,5]]),
      ground:[[5,1,2,7],[1,3,9,1],[4,5,5,2]]},
    // Stiltmere: wide and loose, a fen town of planked lanes inside a palisade; a long hall on the north wall, the houses off a spine.
    {name:'Stiltmere',fac:1,x0:44,y0:40,w:13,h:9,gate:'E',race:'mirekin',spots:{square:[8.5,4.1]},wall:'palisade',
      buildings:townPlan(44,40,[['auction',1,1],['smithy',4,1],['hall-long',6,1],['chapel',11,1],['inn',3,5],['board',6,4],['house-gable',1,4],['house-croft',8,6]]),
      ground:[[1,3,11,1],[7,3,1,5],[10,4,2,2]]},
    // Hornridge: a hold on a long slope, the gate at the top and two terraces down to the inn.
    {name:'Hornridge',fac:1,x0:58,y0:45,w:11,h:13,gate:'N',race:'thornhide',spots:{square:[5.5,6.1]},
      buildings:townPlan(58,45,[['auction',1,1],['smithy',4,1],['hall',7,1],['chapel',9,3],['inn',2,8],['board',8,8],['house-cottage',1,4],['house-croft',3,4],['house-cottage',7,4]]),
      ground:[[5,1,2,11],[1,3,9,1],[1,6,9,1]]},
  ],
  landmarks:[
    // The great dungeon, beside the Weirgate ford on the south bank. entry: the level a background group first goes down (#902).
    {kind:'crypt',name:'The Drowned Weir',boss:'Weir-Warden Orsk',x:81.5,y:38.1,mouth:{x0:80,y0:36,w:3,h:3},exclude:3.5,cd:25,rooms:VALE_WEIR_ROOMS,entry:7,
      sign:CRYPT_SIGN,captain:CRYPT_CAPTAIN},
    // Three smaller delves along the climb.
    {kind:'crypt',name:'The Kestrel Barrow',boss:'Lord Merrin Hawkwright',x:68.5,y:23.1,mouth:{x0:67,y0:21,w:3,h:3},exclude:3.5,cd:25,rooms:VALE_KESTREL_ROOMS,entry:4},
    {kind:'crypt',name:'The Sallow Vaults',boss:'Captain Dane Sallow',x:50.5,y:56.1,mouth:{x0:49,y0:54,w:3,h:3},exclude:3.5,cd:25,rooms:VALE_VAULT_ROOMS,entry:4},
    {kind:'crypt',name:'The Brandwright Kiln',boss:'The Kiln-Warden',x:115.5,y:44.1,mouth:{x0:114,y0:42,w:3,h:3},exclude:3.5,cd:25,rooms:VALE_KILN_ROOMS,entry:10},
    // The raid lair, at the head of the river.
    {kind:'lair',name:'Kragmaw',x:134.5,y:30.5,r:5.4,inner:4,mouth:'W',exclude:7.5,light:{big:1}},
  ],
  outposts:[
    {id:'weirgate',name:'Weirgate Watch',x:78.5,y:24.5,r:3.5},
    {id:'kilnmark',name:'Kilnmark Cross',x:108.5,y:39.5,r:3.5},
  ],
  points:{
    lowN:[26,31],lowS:[26,36],           // the Low Bridge
    fordN:[76,26],fordS:[76,33],         // the Weirgate ford (no road crosses it)
    highN:[110,31],highS:[110,36],       // the High Bridge
    lairGate:[128,30],
    northWay:[34,21],                    // keeps the Gullstrand-Hawkstead road off the river bank (its gate faces the water)
  },
  roads:[
    {from:'Aldermere',to:'Gullstrand'},
    {from:'Gullstrand',to:'lowN'},{from:'lowN',to:'lowS'},{from:'lowS',to:'Brandhold'},
    {from:'Gullstrand',via:['northWay'],to:'Hawkstead'},
    {from:'Brandhold',to:'Stiltmere'},{from:'Stiltmere',to:'Hornridge'},
    {from:'Hawkstead',to:'fordN'},{from:'Hornridge',to:'fordS'},
    {from:'fordS',to:'The Drowned Weir'},
    {from:'Hawkstead',to:'The Kestrel Barrow'},
    {from:'Stiltmere',to:'The Sallow Vaults'},
    {from:'fordN',to:'highN'},{from:'highN',to:'highS'},{from:'fordS',to:'highS'},
    {from:'highS',to:'The Brandwright Kiln'},
    {from:'highN',to:'lairGate'},
  ],
  lights:{townTorches:[[10.5,3.4],[10.5,6.4],[4,3],[8,3]]},
  spawn:{townPad:[4,3],nearest:30},
  nodes:{respawn:{herb:240,ore:480,hide:180,fish:120},regions:{
    wendmouth:{herb:10,ore:4,hide:8,fish:8},sallowfen:{herb:8,ore:4,hide:6,fish:5},hawkwold:{herb:6,ore:8,hide:7,fish:3},
    greywood:{herb:9,ore:6,hide:8,fish:4},ashenfold:{herb:3,ore:9,hide:6,fish:1},rimecrown:{herb:3,ore:6,hide:6,fish:0}}},
  labels:[['WENDMOUTH',26,10],['SALLOWFEN',57,57],['HAWKWOLD',44,4],['GREYWOOD',88,18],['ASHENFOLD',112,12],['RIMECROWN',134,10],
    ['ALDERMERE',9.5,3],['GULLSTRAND',11.5,16],['HAWKSTEAD',57.5,9],['BRANDHOLD',11.5,41],['STILTMERE',49.5,39],['HORNRIDGE',63.5,44]],
};

// ---- choosing the world ----
// `?world=stepping` in the browser, ELDMOOR_WORLD=stepping in Node (or globalThis.ELDMOOR_WORLD
// set before the first import, for tests); default eldmoor. Everything that needs the map size
// or the spec goes through ACTIVE_SPEC / WORLD_ID so the choice is made exactly once.
export const WORLDS={eldmoor:ELDMOOR,stepping:STEPPING,vale:VALE};
function pickWorld(){
  let id=null;
  try{if(typeof location!=='undefined'&&location.search)id=new URLSearchParams(location.search).get('world')}catch(e){}
  if(!id&&typeof globalThis.ELDMOOR_WORLD==='string')id=globalThis.ELDMOOR_WORLD;
  if(!id){const p=globalThis.process;if(p&&p.env&&p.env.ELDMOOR_WORLD)id=p.env.ELDMOOR_WORLD}
  id=String(id||'eldmoor').toLowerCase();
  return WORLDS[id]?id:'eldmoor'}
export const WORLD_ID=pickWorld();
export const ACTIVE_SPEC=WORLDS[WORLD_ID];
