// DM-made dungeon sites (issue #69, slice 1): the themes the DM may raise with the create_site lever, as pure data.
// Logic lives in sim/sites.js. Owned by ai-designer; names recorded in docs/LORE.md ("DM-made sites").
//   enc:    the encounter-builder theme (data/encounter-tables.js THEMES, SITE_BOSSES) the rooms and boss come from
//   label:  what the place is, in a word
//   name:   how a site's name is built from a place word (WORDS below): n => 'the Sedgemere Barrow'
//   rooms:  chamber names per room kind (guard, trap, puzzle, shrine, treasure, boss); the generator walks each list in order
//   frame:  the first line a company hears in a chamber of that kind ({h} is the hazard's name for trap, puzzle and shrine)
//   mouth:  how the way in looks from outside (the discovery line)
//   relic:  the epic tables the boss's guaranteed epic comes from: 'crypt' = the Crypt's (DG_EPICS), 'zone' = the region's
export const SITE_THEMES={
  barrow:{enc:'crypt',label:'barrow',relic:'crypt',name:n=>'the '+n+' Barrow',mouth:'a low stone door in a grassed mound, its lintel cut with worn signs',
    rooms:{guard:['the Bone Passage','the Grave Niches','the Low Hall'],trap:['the Sunken Floor','the Narrow Stair'],puzzle:['the Door of Names'],shrine:['the Candle Alcove'],
      treasure:['the Grave-Goods Vault'],boss:['the Barrow-Heart']},
    frame:{guard:'Old bones shift in the niches as the light finds them.',trap:'The floor here is older than the walls. Ahead lies {h}.',puzzle:'The way on is shut: {h}.',
      shrine:'A small alcove of candle stubs, and {h}.',treasure:'Grave-goods lie heaped where the mourners left them, and something keeps them still.',
      boss:'The barrow\'s heart. Whoever was buried here never lay down.'}},
  fortress:{enc:'fortress',label:'fortress',relic:'zone',name:n=>n+' Hold',mouth:'a palisade of sharpened stakes around a squat stone keep, smoke rising from inside',
    rooms:{guard:['the Gatehouse','the Barracks','the Wall Walk'],trap:['the Killing Yard','the Murder Holes'],puzzle:['the Barred Postern'],shrine:['the Old Chapel'],
      treasure:['the Strongroom'],boss:['the Great Hall']},
    frame:{guard:'Shouts go up along the wall: they have seen you.',trap:'An open yard, too quiet. Ahead lies {h}.',puzzle:'A side door, and {h}.',
      shrine:'A chapel the outlaws use as a storeroom, and {h}.',treasure:'Chests stacked high with what the roads paid in toll.',
      boss:'The great hall, its table cleared for a fight. The one who holds this keep stands at the head of it.'}},
  temple:{enc:'temple',label:'temple',relic:'crypt',name:n=>'the Temple of '+n,mouth:'broken steps going down to a pillared door half buried in silt',
    rooms:{guard:['the Narthex','the Cloister','the Choir'],trap:['the Flooded Aisle','the Fallen Nave'],puzzle:['the Rune Door'],shrine:['the Lady Chapel'],
      treasure:['the Reliquary'],boss:['the Sanctum']},
    frame:{guard:'Dry voices echo under the vault, singing a hymn nobody alive remembers.',trap:'Water stands knee-deep between the pillars. Ahead lies {h}.',puzzle:'The way on is shut: {h}.',
      shrine:'A side chapel still lit by something, and {h}.',treasure:'Relics in their cases, and those sworn to keep them.',
      boss:'The sanctum. Its keeper turns from the altar.'}},
  mine:{enc:'mine',label:'mine',relic:'zone',name:n=>'the '+n+' Delvings',mouth:'a timbered adit in the hillside, rails running into the dark',
    rooms:{guard:['the Upper Gallery','the Ore Chute','the Long Seam'],trap:['the Shaft','the Rotten Props'],puzzle:['the Winch Room'],shrine:['the Miners\' Shrine'],
      treasure:['the Tally Room'],boss:['the Deep Seam']},
    frame:{guard:'Something moves in the old workings; the rails hum with it.',trap:'The timbers creak overhead. Ahead lies {h}.',puzzle:'The lift is stuck: {h}.',
      shrine:'A niche where the miners left their tokens, and {h}.',treasure:'The tally room, where the ore was weighed. Some of it is still here.',
      boss:'The deepest seam, warm as a forge. What dug the last of it is waiting.'}},
  den:{enc:'den',label:'den',relic:'zone',name:n=>'the '+n+' Den',mouth:'a dark hollow under roots and boulders, the ground around it trodden bare and strewn with bones',
    rooms:{guard:['the Run','the Gnawing Hollow','the Litter Cave'],trap:['the Sinkhole','the Loose Scree'],puzzle:['the Choked Passage'],shrine:['the Old Spring'],
      treasure:['the Hoard of Bones'],boss:['the Deep Den']},
    frame:{guard:'Eyes in the dark, then teeth.',trap:'The ground is soft and stinks. Ahead lies {h}.',puzzle:'The passage narrows: {h}.',
      shrine:'A trickle of clean water in the dark, and {h}.',treasure:'Bones of everything the den has eaten, and what those things carried.',
      boss:'The deepest hollow. The den\'s mother rises from her bed.'}},
  ruin:{enc:'ruin',label:'ruin',relic:'zone',name:n=>'the Ruins of '+n,mouth:'roofless walls and a cellar stair, the stones scorched black',
    rooms:{guard:['the Broken Court','the Cellars','the Collapsed Hall'],trap:['the Fallen Stair','the Sagging Gallery'],puzzle:['the Sealed Study'],shrine:['the Household Shrine'],
      treasure:['the Hidden Strongroom'],boss:['the Throne Room']},
    frame:{guard:'Things that should have stayed buried come up out of the rubble.',trap:'The stones shift underfoot. Ahead lies {h}.',puzzle:'A door left locked: {h}.',
      shrine:'A household shrine, its saint\'s face worn smooth, and {h}.',treasure:'Behind a false wall, what the last lord could not carry away.',
      boss:'The throne room, open to the sky. Its last lord still holds court.'}},
};
export const SITE_THEME_IDS=Object.keys(SITE_THEMES);
// Place words that never pair (lore check on #69): a famous name, or one that reads badly. A pair whose join doubles a letter
// (Wold+dell) or that equals a region or town name (Hoar+fell, Sedge+water) is skipped by the generator as well.
export const SITE_BANNED=['Winterfell','Sedgewater','Hoarfell','Soothearth','Slagcrag','Brambleley','Rimereach','Oldmoor'];

// Place words for site names, by region biome (world/spec.js regions[].biome), first part then second part. A biome
// not listed uses `other`. Built to read like the zone's own names (Thornvale, Mirefen, Cinderpass, Hoarfell).
export const SITE_WORDS={
  meadow:[['Thorn','Bramble','Oak','Hawk','Briar','Wold'],['hollow','ford','wick','dell','stead','ley']],
  fen:[['Sedge','Reed','Murk','Eel','Bitter','Silt'],['mere','holm','fen','marsh','water','pool']],
  ash:[['Cinder','Ember','Slag','Soot','Char','Flint'],['crag','fell','gorge','scar','hearth','rock']],
  tundra:[['Rime','Frost','Hoar','Snow','Tarn','Winter'],['fell','cairn','reach','howe','moor','tor']],
  other:[['Grey','Stone','Black','Old','Raven','Wyrm'],['moor','holt','stead','cairn','dale','by']],
};
