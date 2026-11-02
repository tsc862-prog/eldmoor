// Monster table and spawn counts. Owned by creature-designer.
// z: zone index (0 Thornvale, 1 Mirefen, 2 Cinderpass, 3 Hoarfell). lv: level range.
// spr: key into render/sprites SPR. col: palette for that sprite. loot: trade good. q: quest title.
// Stats are not here: the formula (maxhp 25+lvl*16, hit 3+lvl*2) is tilted by each species' role in data/bestiary.js,
// which also holds family, abilities, resistances, behaviour and loot. Add a row here and a block there together.
export const MOBS={
  wolf:{name:'Timber Wolf',pl:'Timber Wolves',z:0,lv:[1,3],spr:'wolf',col:{G:'#9a9aa8',E:'#e04040'},loot:'Wolf Pelt',q:'Wolves at the Gate'},
  boar:{name:'Bristleback Boar',pl:'Bristleback Boars',z:0,lv:[2,5],spr:'boar',col:{B:'#7a4a2a',T:'#f0ead0',D:'#3a2418'},loot:'Boar Tusk',q:'Tusks for the Tanner'},
  spider:{name:'Webspinner',pl:'Webspinners',z:0,lv:[3,6],spr:'spider',col:{K:'#4a3450',L:'#2a1a2a',E:'#e04040'},loot:'Silk Bundle',q:'Cut the Webs'},
  bog:{name:'Bogling',pl:'Boglings',z:1,lv:[7,10],spr:'bog',col:{G:'#5aa060',E:'#f0f0a0',F:'#2a6a40'},loot:'Fen Moss',q:'Trouble in the Fen'},
  mudboar:{name:'Mudback Boar',pl:'Mudback Boars',z:1,lv:[9,12],spr:'boar',col:{B:'#5e5a30',T:'#e8e0c0',D:'#2a2814'},loot:'Thick Hide',q:'Hides for Winter'},
  lurker:{name:'Fen Lurker',pl:'Fen Lurkers',z:1,lv:[10,13],spr:'spider',col:{K:'#2f6a42',L:'#1e3a26',E:'#f0e040'},loot:'Venom Sac',q:'Venom for the Apothecary'},
  golem:{name:'Cinder Golem',pl:'Cinder Golems',z:2,lv:[11,15],spr:'golem',col:{R:'#7a6a62',E:'#ff8a2a'},loot:'Ember Core',q:'Heart of the Mountain'},
  drake:{name:'Ash Drake',pl:'Ash Drakes',z:2,lv:[13,17],spr:'drake',col:{R:'#a83a2a',W:'#d86a3a',E:'#ffe060'},loot:'Cinder Scale',q:'Ash on the Wind'},
  rimehound:{name:'Rimehound',pl:'Rimehounds',z:3,lv:[15,18],spr:'wolf',col:{G:'#6e86a0',E:'#9af0ff'},loot:'Rime Pelt',q:'Howls on the Snowfield'},
  shaghorn:{name:'Tundra Shaghorn',pl:'Tundra Shaghorns',z:3,lv:[16,19],spr:'shaghorn',col:{B:'#5a4634',S:'#3a2c20',H:'#e8dcc0',E:'#ffd040'},loot:'Hoar Wool',q:'Wool for the Weavers'},
  wight:{name:'Tarn Wight',pl:'Tarn Wights',z:3,lv:[18,21],spr:'wight',col:{W:'#7d94ad',E:'#9af8ff',M:'#4a7a96'},loot:'Wight Marrow',q:'What the Tarn Keeps'},
};
export const COUNTS={wolf:11,boar:10,spider:9,bog:14,mudboar:13,lurker:13,golem:11,drake:12,rimehound:9,shaghorn:8,wight:8};

// Named rare elites, one per zone, index = zone. base: the species whose sprite, palette, loot and
// quest tag it shares. lvl: zone max + 2 (Hoarfell's max is the level cap, 20). scale multiplies the
// formula hp and hit multiplies the formula damage in spawnMob. At most one alive per zone; a kill
// drops a guaranteed epic from EPICS[z]. Named in docs/LORE.md under "Rare elites".
export const ELITES=[
  {name:'Hollowfang',title:'the Old Wolf of Thornvale',base:'wolf',lvl:7,scale:2.2,hit:1.5},
  {name:'Old Mother Sedge',title:'Matriarch of the Fen',base:'lurker',lvl:12,scale:2.2,hit:1.5},
  {name:'Scoriath',title:'the Drake of the High Pass',base:'drake',lvl:17,scale:2.2,hit:1.5},
  {name:'Ulfryn Coldmarrow',title:'the Tarn-King',base:'wight',lvl:22,scale:2.2,hit:1.5},
];
// Ecology knobs. cap: zone population ceiling as a multiple of the COUNTS total. emptyAfter: game
// minutes without a hero in the zone before it counts as unhunted. tick: real seconds between
// growth/drift passes. drift: tiles a mob's home slides toward the nearest road per tick while the
// zone is unhunted. roadMinX: per zone, roads west of this x never attract mobs (keeps Thornvale
// spillover away from the city gates). eliteRoll: 1-in-N chance per real minute that a zone with no
// living elite gets one. eliteCd: game minutes after an elite dies before the next may appear.
export const ECO={cap:1.6,emptyAfter:120,tick:10,drift:.6,roadMinX:[18,0,0,0],eliteRoll:35,eliteCd:600};
