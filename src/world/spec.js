// World specs: the world described as data. `src/world/gen.js` turns a spec
// into tiles, zones, towns, landmarks, roads, spawn points, lights and labels.
// Pure data, no logic. Owned by world-builder.
//
// Shape of a spec:
//   size      {w,h} in tiles. (Must equal W,H in tiles.js until phase 5 decouples them.)
//   seeds     {terrain, detail} fbm seeds for the two biome noise fields.
//   curves    named boundary curves. `axis:'y'` gives an x threshold per row
//             (a north-south line that wanders), `axis:'x'` a y threshold per
//             column. value = base + round(sum of sin terms + noise term):
//               sin:[[period,amp,phase], ...]      amp*sin(t/period+phase)
//               noise:{seed,scale,amp,slice}        (vnoise(..)-.5)*amp sampled at t/scale
//   regions   ordered; later regions override earlier ones where masks overlap.
//             {id, name, band:[minLvl,maxLvl], biome, mask}
//             biome: 'meadow' | 'fen' | 'ash' | 'tundra' (painters live in gen.js)
//             mask kinds: 'all' | 'rect'{x0,y0,x1,y1} | 'west-of-curve' |
//               'east-of-curve' | 'north-of-curve' | 'south-of-curve' (curve: name) |
//               'and'{masks} | 'or'{masks} | 'not'{mask}
//   river     {curve, width} painted as RIVER along the curve; roads bridge it.
//   towns     {name, fac, x0, y0, w, h, gate:'E'|'W'|'N'|'S', race}
//             WALL border, FLOOR inside, two gate tiles in the middle of the gate
//             wall; auction house, quest giver, gate point and graveyard are
//             derived from the rect by gen.js (same offsets as the old mkCity).
//   landmarks {kind:'lair', name, x, y, r, inner, mouth:'W'|'E'|'N'|'S', exclude, light}
//             {kind:'crypt', name, boss, x, y, mouth:{x0,y0,w,h}, exclude, cd}
//   points    named waypoints that roads may reference.
//   roads     either a polyline [[x,y],...] painted as-is, or
//             {from, to, via:[...]} where endpoints are town names (their gate),
//             landmark names or point names, routed with A* over tile cost.
//   lights    {townTorches:[[dx,dy],...]} offsets from each town's x0,y0.
//   spawn     {townPad:[px,py]} tiles around a town rect that are never spawn points.
//   labels    [['TEXT',x,y],...]; omitted => one per region and town, auto-placed.

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
    {name:'Highgate',fac:0,x0:2,y0:2,w:11,h:9,gate:'E',race:null},
    {name:'Grimhold',fac:1,x0:2,y0:39,w:11,h:9,gate:'E',race:null},
  ],
  landmarks:[
    {kind:'lair',name:'Kragmaw',x:71.5,y:25.5,r:5.4,inner:4,mouth:'W',exclude:7.5,light:{big:1}},
    {kind:'crypt',name:'The Sunken Crypt',boss:'Lich-Warden Vesk',x:44.5,y:43.1,mouth:{x0:43,y0:41,w:3,h:3},exclude:3.5,cd:25},
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
  roads:[
    {from:'Wendmere',to:'crossroads'},
    {from:'crossroads',to:'The Barrow Gate'},
  ],
  lights:{townTorches:[[10.5,3.4],[10.5,6.4],[4,3],[8,3]]},
  spawn:{townPad:[4,3]},
};
