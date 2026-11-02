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
//   river     {curve, width} painted as RIVER along the curve; roads bridge it.
//   towns     {name, fac, x0, y0, w, h, gate:'E'|'W'|'N'|'S', race, spots, npcs}
//             WALL border, FLOOR inside, two gate tiles in the middle of the gate
//             wall; gate point and graveyard are derived from the rect by gen.js.
//             spots: interior points as [dx,dy] offsets from x0,y0 where the
//             townsfolk keep their posts: quartermaster (the auction house, the
//             heroes' `ah` stop), gate (the gate captain, the quest-giver `qg`
//             stop), inn, smith, chapel, square. Missing spots get defaults laid
//             out relative to the gate side (sim/npcs.js, data/npcs.js).
//             npcs: role ids staffed here (default: every role in data/npcs.js).
//   landmarks {kind:'lair', name, x, y, r, inner, mouth:'W'|'E'|'N'|'S', exclude, light}
//             {kind:'crypt', name, boss, x, y, mouth:{x0,y0,w,h}, exclude, cd, rooms}
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

// The Sunken Crypt's chambers, in the order the Fellowship meets them (sim/crawl.js). Bestiary species, no new creatures.
const CRYPT_ROOMS=[
  {id:'stair',name:'The Weeping Stair',frame:'Water runs down the steps of the stair and something small scuttles in the dark below.',
    foes:[{type:'tombskit',n:3}],lvl:-1,hit:.10,rounds:2},
  {id:'ossuary',name:'The Ossuary',frame:'Shelves of old bone line the walls. Some of it stands up as the light reaches it.',
    foes:[{type:'shambler',n:2}],lvl:0,hit:.13,rounds:2},
  {id:'gallery',name:"The Archers' Gallery",frame:'A long gallery with arrow-slits in every pillar. Dry bowstrings creak somewhere above.',
    foes:[{type:'boneshot',n:2,hits:1},{type:'shambler',n:1}],lvl:0,hit:.13,rounds:2},
  {id:'court',name:'The Drowned Court',frame:'The floor is a black mirror of still water. Grave Wardens stand in it to the knee, keeping a court that no longer sits.',
    foes:[{type:'graveward',n:2,hits:2}],lvl:1,hit:.17,rounds:2},
  {id:'vigil',name:'The Vigil Chamber',frame:'The last door. Something has kept watch here a very long time, and the cold has a voice. It knows every name in the party.',
    foes:[{type:'graveward',n:1,name:'Lich-Warden Vesk',hits:4,atk:1.6},{type:'tombskit',n:1}],lvl:2,hit:.19,rounds:2,boss:true},
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
    // spots: the quartermaster's table and the captain's gate post are the heroes' old ah/qg stops;
    // the inn is by the south wall, the forge by the north, the chapel in the gate-side corner,
    // the square in the middle of the hero path. Homes line the back (west) wall at night.
    {name:'Highgate',fac:0,x0:2,y0:2,w:11,h:9,gate:'E',race:'hallowan',
      spots:{quartermaster:[3.5,3.8],gate:[7.5,3.8],inn:[3.5,7.3],smith:[5.5,1.6],chapel:[8.5,1.9],square:[5.5,6.1]}},
    {name:'Grimhold',fac:1,x0:2,y0:39,w:11,h:9,gate:'E',race:'ashfolk',
      spots:{quartermaster:[3.5,3.8],gate:[7.5,3.8],inn:[3.5,7.3],smith:[5.5,1.6],chapel:[8.5,1.9],square:[5.5,6.1]}},
  ],
  landmarks:[
    {kind:'lair',name:'Kragmaw',x:71.5,y:25.5,r:5.4,inner:4,mouth:'W',exclude:7.5,light:{big:1}},
    {kind:'crypt',name:'The Sunken Crypt',boss:'Lich-Warden Vesk',x:44.5,y:43.1,mouth:{x0:43,y0:41,w:3,h:3},exclude:3.5,cd:25,rooms:CRYPT_ROOMS},
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
const TOWN_SPOTS={quartermaster:[3.5,3.8],gate:[7.5,3.8],inn:[3.5,7.3],smith:[5.5,1.6],chapel:[8.5,1.9],square:[5.5,6.1]};
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
      mask:{kind:'and',masks:[{kind:'east-of-curve',curve:'cinderEdge'},{kind:'west-of-curve',curve:'paleEdge'},{kind:'north-of-curve',curve:'frostLine'}]}},
    {id:'palereach',name:'Palereach',band:[18,22],biome:'tundra',far:true,
      mask:{kind:'and',masks:[{kind:'east-of-curve',curve:'paleEdge'},{kind:'north-of-curve',curve:'frostLine'}]}},
  ],
  river:{curve:'river',width:2},
  towns:[
    {name:'Highgate',fac:0,x0:2,y0:2,w:11,h:9,gate:'E',race:'hallowan',spots:TOWN_SPOTS},
    {name:'Grimhold',fac:1,x0:2,y0:87,w:11,h:9,gate:'E',race:'ashfolk',spots:TOWN_SPOTS},
    {name:'Cairnmoot',fac:0,x0:28,y0:30,w:11,h:9,gate:'E',race:'tarrow',spots:TOWN_SPOTS},
    {name:'Murkstead',fac:1,x0:28,y0:62,w:11,h:9,gate:'E',race:'mirekin',spots:TOWN_SPOTS},
  ],
  landmarks:[
    {kind:'crypt',name:'The Sunken Crypt',boss:'Lich-Warden Vesk',x:72.5,y:86.1,mouth:{x0:71,y0:84,w:3,h:3},exclude:3.5,cd:25,rooms:CRYPT_ROOMS},
    {kind:'lair',name:'Kragmaw',x:140.5,y:66.5,r:5.4,inner:4,mouth:'W',exclude:7.5,light:{big:1}},
    // Placeholder second dungeon: an entrance only, no group, boss or loot yet (see LORE.md).
    {kind:'crypt',name:'The Hollow Cairn',boss:'The Cairn-Warden',x:84.5,y:14.1,mouth:{x0:83,y0:12,w:3,h:3},exclude:3.5,cd:25},
  ],
  points:{hubW:[58,46],hubE:[104,52],lairGate:[134,66],frostGate:[116,24],paleGate:[146,22]},
  roads:[
    {from:'Highgate',to:'Cairnmoot'},
    {from:'Cairnmoot',to:'hubW'},
    {from:'Grimhold',to:'Murkstead'},
    {from:'Murkstead',to:'hubW'},
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
    lowmark:{herb:16,ore:8,hide:12,fish:8},sedgewater:{herb:14,ore:8,hide:12,fish:6},cairnwold:{herb:12,ore:12,hide:10,fish:0},
    cinderreach:{herb:8,ore:14,hide:10,fish:0},rimeholt:{herb:8,ore:10,hide:10,fish:0},palereach:{herb:6,ore:8,hide:8,fish:0}}},
};

// ---- choosing the world ----
// `?world=stepping` in the browser, ELDMOOR_WORLD=stepping in Node (or globalThis.ELDMOOR_WORLD
// set before the first import, for tests); default eldmoor. Everything that needs the map size
// or the spec goes through ACTIVE_SPEC / WORLD_ID so the choice is made exactly once.
export const WORLDS={eldmoor:ELDMOOR,stepping:STEPPING};
function pickWorld(){
  let id=null;
  try{if(typeof location!=='undefined'&&location.search)id=new URLSearchParams(location.search).get('world')}catch(e){}
  if(!id&&typeof globalThis.ELDMOOR_WORLD==='string')id=globalThis.ELDMOOR_WORLD;
  if(!id){const p=globalThis.process;if(p&&p.env&&p.env.ELDMOOR_WORLD)id=p.env.ELDMOOR_WORLD}
  id=String(id||'eldmoor').toLowerCase();
  return WORLDS[id]?id:'eldmoor'}
export const WORLD_ID=pickWorld();
export const ACTIVE_SPEC=WORLDS[WORLD_ID];
