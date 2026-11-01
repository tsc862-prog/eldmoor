// Encounter tables (issue #84): themes, room plans, budget constants, traps, puzzles, shrines and boss
// names for the encounter builder (sim/encounterbuilder.js). Pure data. Owned by creature-designer.
// Pools come from the bestiary live: a region's field species (MOBS rows with z = region) plus the site
// foes (VARIANTS) whose `themes` list the theme.
//
// Budget: a creature costs ROLE.cost x LEVEL_STEP^(its level - the party's level). A party of n heroes at its
// own level spends n x PER_HEAD per encounter, so four heroes meet about four ordinary foes, two heroes
// about two. Rooms scale that by ROOM_BUDGET. Difficulty modifies PER_HEAD (easy .75, hard 1.25).

export const PER_HEAD=.95;
export const LEVEL_STEP=1.22;
export const MAX_FOES=7;
export const ROOM_BUDGET={guard:1,treasure:.55,shrine:.4,trap:.3,puzzle:.3,boss:.9}; // boss: the leader's own cost comes first
export const DIFFICULTY={easy:.75,normal:1,hard:1.25};

// fam: family weights (1 = neutral; anything unlisted counts .4 so a region with no matching family still
// fills). variants: whether site foes may appear. plan: room kinds in order; the builder keeps the first
// and the boss, and trims or repeats the middle to the asked size.
export const THEMES={
  crypt:   {label:'Crypt',   fam:{undead:4,vermin:1.5},            variants:true,  plan:['guard','trap','guard','puzzle','shrine','guard','treasure','boss']},
  fortress:{label:'Fortress',fam:{bandit:4,'brute-folk':2,beast:.5},variants:true,  plan:['guard','guard','trap','treasure','guard','shrine','boss']},
  den:     {label:'Den',     fam:{beast:4,vermin:1.5},             variants:true,  plan:['guard','guard','trap','treasure','guard','boss']},
  mine:    {label:'Mine',    fam:{elemental:4,vermin:2},           variants:true,  plan:['guard','trap','guard','puzzle','treasure','guard','boss']},
  temple:  {label:'Temple',  fam:{undead:2,elemental:3},           variants:true,  plan:['guard','puzzle','shrine','guard','trap','treasure','boss']},
  ruin:    {label:'Ruin',    fam:{undead:2.5,bandit:2,vermin:1.5}, variants:true,  plan:['guard','trap','shrine','guard','puzzle','treasure','boss']},
  road:    {label:'Road',    fam:{beast:2,bandit:3,'brute-folk':1.5},variants:true, plan:['guard','guard','treasure','boss']},
};

export const TRAPS=[
  {id:'spikes',name:'a pit of sharpened stakes',dmg:.5},
  {id:'gas',name:'a vent of marsh gas',dmg:.4},
  {id:'alarm',name:'a tripwire strung with bells',dmg:0,wakes:true},
  {id:'fall',name:'a rotten floor over a drop',dmg:.6},
];
export const PUZZLES=[
  {id:'riddle',name:'a riddle cut over a sealed door'},
  {id:'lever',name:'three levers and one right order'},
  {id:'runes',name:'a ring of runes that must be touched in turn'},
  {id:'weights',name:'a scale that wants an exact weight on each pan'},
];
export const SHRINES=[
  {id:'rest',name:'a quiet shrine where wounds close',heal:.4},
  {id:'ward',name:'a shrine whose blessing turns the next blow',ward:1},
  {id:'sight',name:'a shrine that shows the way on',map:1},
];

// Boss pool per theme: variant (the body), a title, and the first level the boss is fit for. The builder picks
// the highest entry whose level is at or below the site's top band; a custom epic table may override loot.
export const SITE_BOSSES={
  crypt:   [{name:'the Barrow-Reeve',title:'Keeper of the Low Gate',variant:'graveward',from:1},{name:'Marrowmother Ysolt',title:'who counts the drowned',variant:'graveward',from:9},{name:'the Hollow Abbot',title:'of the Last Candle',variant:'graveward',from:15}],
  fortress:[{name:'Captain Redhand',title:'of the Toll Road',variant:'captain',from:1},{name:'Warden Brannock Sull',title:'the Gatebreaker',variant:'captain',from:9},{name:'the Iron Reeve',title:'of the Fallen Keep',variant:'captain',from:15}],
  den:     [{name:'Dunmaw',title:'Mother of the Den',variant:'denmother',from:1},{name:'Long Ursel',title:'the Dam of Many',variant:'denmother',from:9},{name:'Snowdam',title:'Queen of the High Burrow',variant:'denmother',from:15}],
  mine:    [{name:'the Cave Duchess',title:'of the Lower Seams',variant:'cavecrawler',from:1},{name:'Slagheart',title:'the Cold Furnace',variant:'slagmote',from:9},{name:'Emberdeep Kor',title:'who never sleeps',variant:'slagmote',from:14}],
  temple:  [{name:'the Veiled Cantor',title:'of the Broken Choir',variant:'graveward',from:1},{name:'Ashen Prior Orsan',title:'Last of the Vigil',variant:'graveward',from:10},{name:'the Tarnkeeper',title:'Warden of the Tarn Stair',variant:'graveward',from:16}],
  ruin:    [{name:'the Stone Steward',title:'of the Empty Hall',variant:'shambler',from:1},{name:'Lord Orrick Dane',title:'the Unburied',variant:'shambler',from:9},{name:'the Sundered Queen',title:'of the Cairn Court',variant:'shambler',from:15}],
  road:    [{name:'Black Tam',title:'the Toll-Taker',variant:'captain',from:1},{name:'Sable Marrin',title:'Scourge of the Drovers',variant:'captain',from:9},{name:'the Winter Reeve',title:'of the Snow Road',variant:'captain',from:15}],
};

// Loot per room kind. gold: x level. goods: how many trade goods of the region. gear: {chance, quality, lead}
// ilvl = level + lead. The boss room adds named epics (see the builder).
export const ROOM_LOOT={
  guard:   {gold:[.4,.9],goods:[0,1],gear:{chance:.12,quality:'fine',lead:0}},
  trap:    {gold:[0,.3],goods:[0,0],gear:{chance:0,quality:'fine',lead:0}},
  puzzle:  {gold:[.6,1.2],goods:[0,1],gear:{chance:.3,quality:'fine',lead:0}},
  treasure:{gold:[1.5,3],goods:[1,3],gear:{chance:.6,quality:'fine',lead:1}},
  shrine:  {gold:[0,0],goods:[0,0],gear:{chance:0,quality:'fine',lead:0}},
  boss:    {gold:[3,5],goods:[2,3],gear:{chance:1,quality:'rare',lead:1}},
};
// Hard cap on special foes (customFoe): how many per region per game-day, and the tweak points one may spend.
export const CUSTOM={perRegionDay:2,points:3,costs:{rename:0,level:1,swap:1,resist:1},maxLevels:2};
