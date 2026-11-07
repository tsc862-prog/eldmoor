// The first delve (issue #922): the short dungeon a new company plays before the open world, as pure data. Logic is in
// sim/prologue.js. Owned by ai-designer; names recorded in docs/LORE.md ("First delves"). A new town gets its own by adding a row.
//   PROLOGUE_DEFAULT  a setup world's opening when its setup says nothing: the one line to change. Worlds with no setup never get
//                     one unless asked (init({prologue}), ELDMOOR_PROLOGUE, ?prologue=, play-headless --prologue).
//   PROLOGUES         the rows, looped over. A company takes the first free row naming its hall town, else the first free row of its
//                     faction; each row is used once in a world, and a company with none left opens in the hall as usual.
//     towns    the hall towns it belongs to (absent: any town of its faction)
//     fac      the faction index
//     theme    a theme of data/sites.js: the interior's look and the mouth's words
//     name     the site's name; boss its keeper, as the Chronicle names it
//     scenario what the company sees at the mouth, read by everyone ({town} and {walk}, "a short walk", are filled in)
//     dm       what lies behind it, for the DM's prep and frames only: never reaches a hero
//     fill     lines the DM's reflex opens with when the DM is slow, one picked by hash
//     xp       share of an ordinary site's XP (clearXp): the delve ends about level 2
//     loot     {gold shared, goods, ilvl, quality}: plain, and no epic
//     rooms    the crawl's rooms, as a site's (sim/crawl.js): {id, name, frame, foes:[{type, n, name?, hits?, atk?}], alvl, hit, rounds, boss?}
//     closing  the words at the hall gate: clear, or left (they came out without finishing it). {crypt} names the great dungeon
export const PROLOGUE_DEFAULT='delve';
export const PROLOGUE_VALUES=['delve','none'];
// How far the mouth stands from the hall's gate, in words ({walk} in a scenario, and the Chronicle line). Tiles from the gate, the first
// row whose upto holds; sim/prologue.js walkWords reads it. Mouths stand 13 to 42 tiles out; most are under 26.
export const WALKS=[
  {upto:26,say:'a short walk'},
  {upto:34,say:'a walk'},
  {upto:Infinity,say:'a long walk'},
];
export const PROLOGUES=[
  {id:'wick-barrow',towns:['Highgate'],fac:0,theme:'barrow',name:'the Wick Barrow',boss:'Old Tallow',
    scenario:'A grey dawn on a grassed mound, {walk} from {town}. The hall sent word to each of you alone: go to the Wick Barrow, put out what walks there, and come back a company or do not come back. The door stone has been dragged aside, and from the inside.',
    dm:'A village sexton called Old Tallow kept the barrow lamps for forty years and would not stop when he died. Nothing here is a grand evil: it is a small sad haunting, a test the hall sets its untried blades. Lamps should feature; the last one is still lit.',
    fill:['Wet grass, cold stone, and the smell of old tallow from the dark.','A lamp burns somewhere below, though nobody living has climbed down to fill it.'],
    xp:.45,loot:{gold:30,goods:['Grave Dust'],ilvl:2,quality:'plain'},
    rooms:[
      {id:'guard',name:'The Lamp Passage',frame:'Dead lamps line a low passage, and things with too many legs drop from the niches.',foes:[{type:'tombskit',n:3,hits:2}],alvl:1,hit:0.42,rounds:6},
      {id:'guard2',name:'The Bearers\' Niches',frame:'Two of the old pallbearers stand up out of their niches, still holding the poles.',foes:[{type:'shambler',n:2,hits:2}],alvl:1,hit:0.56,rounds:6},
      {id:'boss',name:'The Last Lamp',frame:'One lamp still burns here. The thing that tends it turns round, slowly, wick-scissors in its hand.',foes:[{type:'shambler',n:1,name:'Old Tallow',hits:6,atk:1.3},{type:'tombskit',n:1,hits:1}],alvl:2,hit:0.44,rounds:8,boss:true}],
    closing:{clear:'The hall gate of {town}, by evening. The gate captain looks over the grave dirt on you and does not smile. "Old Tallow was the least of what is out there. Walk into {crypt} thinking otherwise and you stay in it."',
      left:'The hall gate of {town}, by evening, with the barrow unfinished behind you. The gate captain counts you. "So now you know what a small one costs. {crypt} is not small."'}},
  {id:'toll-cellars',fac:0,theme:'ruin',name:'the Toll-House Cellars',boss:'Hob Reckoner',
    scenario:'The burnt shell of a toll-house, {walk} from {town}. The hall sent word to each of you alone: road thieves have dug in under it, and whoever clears them may call themselves a company. A cellar stair goes down behind the fallen roof, and someone has swept its top step.',
    dm:'Hob Reckoner kept the tolls here until he burned the place himself and went to ground below with his cousins. A greedy small-time crook, not a mastermind; he will shout about what he is owed.',
    fill:['Soot on the wind, and a cellar stair going down into a smell of old beer.','Somebody below is counting out loud, and stops.'],
    xp:.45,loot:{gold:30,goods:['Wolf Pelt'],ilvl:2,quality:'plain'},
    rooms:[
      {id:'guard',name:'The Beer Cellar',frame:'Broken casks and a lookout who has been at them. His dogs come first.',foes:[{type:'wolf',n:2,hits:2},{type:'reedcutter',n:1,hits:2}],alvl:1,hit:0.42,rounds:6},
      {id:'guard2',name:'The Tally Vault',frame:'Two big men get up from a table of stolen coin and reach for their cudgels.',foes:[{type:'tollbreaker',n:2,hits:2}],alvl:1,hit:0.56,rounds:6},
      {id:'boss',name:'The Strong Cellar',frame:'A heavy door, a ledger, and a man who wants you to know exactly what you owe him.',foes:[{type:'captain',n:1,name:'Hob Reckoner',hits:6,atk:1.3},{type:'reedcutter',n:1,hits:1}],alvl:2,hit:0.44,rounds:8,boss:true}],
    closing:{clear:'The hall gate of {town}, by evening. The gate captain weighs Hob\'s ledger in one hand. "Thieves in a cellar. Good. Now forget it: {crypt} does not bargain, and it does not run out of cousins."',
      left:'The hall gate of {town}, by evening, with the cellars still held behind you. The gate captain sighs. "Cudgels did that. Think on what {crypt} would do."'}},
  {id:'ashpit-den',towns:['Grimhold'],fac:1,theme:'den',name:'the Ashpit Den',boss:'Mother Soot',
    scenario:'Black morning on the spoil heaps, {walk} from {town}. The hall sent word to each of you alone: something breeds in the old ashpit and has been at the goats. Kill it together and the banner has a use for you; do not, and nobody will ask where you went. The hollow under the slag breathes warm.',
    dm:'A scarred she-beast that dens in the town\'s ash heap and has grown fat on goats. The halls send every green blade to this kind of chore, and mock those who fail it. It is an animal, not a villain: cornered, hungry, protecting a litter.',
    fill:['Warm air from the hollow, sour with ash and old bones.','Goat bones crunch underfoot at the lip of the pit.'],
    xp:.45,loot:{gold:30,goods:['Wolf Pelt'],ilvl:2,quality:'plain'},
    rooms:[
      {id:'guard',name:'The Ash Run',frame:'A trodden run through warm ash. Half-grown things come down it snapping.',foes:[{type:'wolf',n:3,hits:2}],alvl:1,hit:0.42,rounds:6},
      {id:'guard2',name:'The Gnawing Hollow',frame:'Two grown boars the den has taken in lift their heads from something that used to be a goat.',foes:[{type:'boar',n:2,hits:2}],alvl:1,hit:0.56,rounds:6},
      {id:'boss',name:'The Warm Bed',frame:'The deepest hollow, hot as an oven. She gets up off her litter, and she is bigger than you were told.',foes:[{type:'denmother',n:1,name:'Mother Soot',hits:6,atk:1.3},{type:'wolf',n:1,hits:1}],alvl:2,hit:0.44,rounds:8,boss:true}],
    closing:{clear:'The hall gate of {town}, by evening, stinking of ash. The gate captain laughs at you, then stops. "You killed a goat thief. Do not get ideas. {crypt} has eaten better than you."',
      left:'The hall gate of {town}, by evening, with the den still breathing behind you. The gate captain spits. "Beaten by a goat thief. Stay out of {crypt}, then; it would not even notice."'}},
  {id:'slag-delving',fac:1,theme:'mine',name:'the Slag Delving',boss:'Gaffer Crook',
    scenario:'The mouth of a worked-out adit, {walk} from {town}. The hall sent word to each of you alone: the shift that went down to strip the old rails has not come up, and the banner wants to know who is worth feeding. The rails run into the dark, and they hum like a struck bell nobody is holding.',
    dm:'Gaffer Crook led the rail-strippers and found it easier to keep the scrap and rob the next shift. He holds the lower gallery with what is left of his crew and the crawlers they let breed. A petty tyrant who thinks being underground makes him a king.',
    fill:['Cold air out of the adit, and the rails humming with something far below.','A dropped pick lies at the mouth, its handle still wet.'],
    xp:.45,loot:{gold:30,goods:['Thick Hide'],ilvl:2,quality:'plain'},
    rooms:[
      {id:'guard',name:'The Rail Gallery',frame:'Pale crawlers pour along the rails toward your light.',foes:[{type:'cavecrawler',n:3,hits:2}],alvl:1,hit:0.42,rounds:6},
      {id:'guard2',name:'The Scrap Heap',frame:'Two of the missing shift, not missing at all, heft their picks over a pile of stripped iron.',foes:[{type:'tollbreaker',n:2,hits:2}],alvl:1,hit:0.56,rounds:6},
      {id:'boss',name:'The Gaffer\'s Gallery',frame:'A chair made of rail ties, a lantern, and a bent old man who tells you this mine is his.',foes:[{type:'captain',n:1,name:'Gaffer Crook',hits:6,atk:1.3},{type:'cavecrawler',n:1,hits:1}],alvl:2,hit:0.44,rounds:8,boss:true}],
    closing:{clear:'The hall gate of {town}, by evening. The gate captain takes the Gaffer\'s lantern and blows it out. "One old man and his bugs. Good enough to eat with us. Not good enough for {crypt}, and do not let anyone tell you it is."',
      left:'The hall gate of {town}, by evening, with the adit still held behind you. The gate captain does not look up. "One old man. Think about that before you think about {crypt}."'}},
];

// The Wending Vale's six first delves (epic #940): one a home town, appended. Each is the same small shape as the rows above
// (three rooms, a keeper, about level 2), written by a helper so the numbers stay in one place: g = the first room's foes, g2 =
// the second's, b = the keeper's species, sup = the keeper's one companion.
const valeDelve=(id,town,fac,theme,name,boss,scenario,dm,fill,goods,g,gn,g2,gn2,b,sup,rn,fr,cl,lf)=>({id,towns:[town],fac,theme,name,boss,scenario,dm,fill,xp:.45,
  loot:{gold:30,goods:[goods],ilvl:2,quality:'plain'},
  rooms:[{id:'guard',name:gn[0],frame:gn[1],foes:[{type:g[0],n:g[1],hits:2}],alvl:1,hit:0.42,rounds:6},
    {id:'guard2',name:gn2[0],frame:gn2[1],foes:[{type:g2[0],n:g2[1],hits:2}],alvl:1,hit:0.56,rounds:6},
    {id:'boss',name:rn,frame:fr,foes:[{type:b,n:1,name:boss,hits:6,atk:1.3},{type:sup,n:1,hits:1}],alvl:2,hit:0.44,rounds:8,boss:true}],
  closing:{clear:cl,left:lf}});
PROLOGUES.push(
  valeDelve('mill-hollow','Aldermere',0,'ruin','the Drowned Millhouse','Miller Quill',
    'A mill that stopped turning, a short walk from {town}. The hall sent word to each of you alone: river-thieves have taken the flooded cellars and the hall wants them out. The wheel hangs half in the Wend and creaks.',
    "Miller Quill ran the mill until the thieves came and now runs them: a fussy, frightened man who sells them flour at robbers' prices. A chore for green blades, not a war.",
    ['Water slaps the wheel, and somebody inside is whispering a count.','Flour dust on the sill, and wet footprints leading in.'],'Wolf Pelt',
    ['reedcutter',2],['The Wheel Cellar','Wet sacks and a lookout who was dozing. His mate wakes faster.'],['tollbreaker',2],['The Flour Loft','Two large men guard what is left of the harvest and do not mean to share it.'],
    'captain','reedcutter','The Millstone Room',"A lantern, a ledger of stolen flour, and a miller who tells you very quickly that it was all the thieves' idea.",
    'The hall gate of {town}, by evening, dusted with flour. The gate captain eyes the ledger. "Thieves in a mill. Good. {crypt} is not a mill."',
    'The hall gate of {town}, by evening, with the mill still held behind you. The gate captain sniffs. "Learn from it. {crypt} will not stop at flour."'),
  valeDelve('gull-cliffs','Gullstrand',0,'den','the Gull Cliff Den','Old Brine',
    'A hollow in the sea-cliffs, a short walk from {town}. The hall sent word to each of you alone: something has been at the nets and the drying racks. Whatever it is has made a den under the roots, and the gulls will not nest near it.',
    "Old Brine is a scarred sea-wolf mother that has fattened on the net-menders' catch. An animal, hungry and guarding young, not a villain.",
    ['Salt wind, fish-bones, and a smell like wet dog from the dark.','Torn nets hang from the roots at the mouth.'],'Wolf Pelt',
    ['wolf',3],['The Net Run','A run trodden through shredded nets. Half-grown things come down it snapping.'],['boar',2],['The Fish Midden',"Two boars have taken the den's leavings and defend them."],
    'denmother','wolf','The Warm Hollow','The deepest hollow, warm and reeking. She gets up off her litter and she is bigger than the net-menders said.',
    'The hall gate of {town}, by evening, reeking of fish. The gate captain nods. "A hungry beast. Be proud, then forget it. {crypt} is hungrier."',
    'The hall gate of {town}, by evening, the den still breathing behind you. The gate captain frowns. "She took the nets and your nerve. {crypt} takes more."'),
  valeDelve('herders-cairn','Hawkstead',0,'barrow',"the Herders' Cairn",'Shepherd Wick',
    'A cairn on the ridge above the sheepwalks, a short walk from {town}. The hall sent word to each of you alone: the old herder buried here is up and counting sheep that are not there. Something small keeps the lambs from the lower fold at night.',
    'Shepherd Wick tended the ridge flocks for sixty years and will not be told the last flock is gone. A sad small haunting; his dogs are bones.',
    ['A cold crook leans against the cairn door and nobody living put it there.','Wind on the ridge, and somewhere a bell with no sheep to wear it.'],'Grave Dust',
    ['tombskit',3],['The Dog Run','Bones of the herd-dogs rattle up from the straw and come at you low.'],['shambler',2],['The Fold Chamber','Two old herdsmen rise from their niches, still holding their crooks.'],
    'shambler','tombskit','The Last Fold','One bell still rings here. The thing that wears it turns slowly, counting.',
    'The hall gate of {town}, by evening, with a cold crook in your pack. The gate captain turns it over. "A sad old man. {crypt} is not sad. It is hungry."',
    'The hall gate of {town}, by evening, the cairn unfinished. The gate captain counts you. "Now you know what a small one costs. {crypt} is not small."'),
  valeDelve('cold-forge','Brandhold',1,'mine','the Cold Forge','Slagmaster Brok',
    'A worked-out forge-adit, a short walk from {town}. The hall sent word to each of you alone: the banner wants its iron back, and a self-crowned smith has been selling it to the river towns. Go in together and bring the hammers out.',
    'Slagmaster Brok walked off with the old forge when the seam failed and now holds the lower floor with his crew and the slag motes the cooling vents breed. A petty tyrant who thinks being underground makes him a king.',
    ['Cold air from the adit and the faint tick of cooling metal far below.','A dropped tongs lies at the mouth, still warm.'],'Thick Hide',
    ['slagmote',3],['The Vent Gallery','Slag motes drift down the vents like sparks and settle on your sleeves.'],['tollbreaker',2],['The Iron Store',"Two of Brok's crew heft hammers over a pile of stolen bar iron."],
    'captain','slagmote','The Cold Anvil','A cold anvil for a throne, a hammer for a sceptre, and a smith who says this forge is his.',
    'The hall gate of {town}, by evening, soot to the elbows. The gate captain laughs. "A smith with a crew. Fine. {crypt} has better smiths and worse manners."',
    'The hall gate of {town}, by evening, the forge still held behind you. The gate captain spits. "Hammers did that. Think on {crypt}."'),
  valeDelve('salt-pans','Stiltmere',1,'ruin','the Salt Pans','Boil-Master Garr',
    'Burnt boiling-sheds on the fen margin, a short walk from {town}. The hall sent word to each of you alone: the salt-boilers have a rival crew who dig in below the old sheds and sell short weight. Clear them and the banner has a use for you.',
    'Boil-Master Garr runs a gang of fen-smugglers out of the cellars of a burnt boiling-house. A loud, greedy small-timer; he will shout about weights and measures.',
    ['Brine and old smoke on the wind, and somebody below arguing about a scale.','A salt-crusted stair going down behind the burnt shed.'],'Wolf Pelt',
    ['reedcutter',2],['The Brine Cellar','Casks of grey salt and two lookouts who have been at the spirits.'],['tollbreaker',2],['The Scale Room','Two big men lean on a crooked scale and reach for their cudgels.'],
    'captain','hedgecaller',"The Boil-Master's Cellar",'A ledger, a crooked scale, and a man who wants you to know exactly what you owe him.',
    'The hall gate of {town}, by evening, crusted white. The gate captain tests the crooked scale. "Short weight. Good riddance. {crypt} does not weigh anything."',
    'The hall gate of {town}, by evening, the cellars still held behind you. The gate captain sighs. "A scale beat you. {crypt} has none."'),
  valeDelve('bone-pit','Hornridge',1,'den','the Bone Pit','Mother Rattle',
    "A pit under the carvers' ridge, a short walk from {town}. The hall sent word to each of you alone: the carvers' offcuts breed something that rattles and eats the town's goats. Kill it together or do not come back and nobody will ask where.",
    "Mother Rattle is a scarred she-beast that dens in the carvers' bone heap and has grown big on goats. An animal, hungry and guarding a litter.",
    ['A dry rattle from the pit, like a bag of teeth being shaken.','Goat bones crunch underfoot at the lip.'],'Wolf Pelt',
    ['wolf',3],['The Offcut Run','A run through splintered bone. Half-grown things come down it snapping.'],['boar',2],['The Gnawing Hollow','Two grown boars the den has taken in lift their heads from something that used to be a goat.'],
    'denmother','wolf','The Rattling Bed','The deepest hollow, a bed of bone chips. She gets up off her litter and she is bigger than you were told.',
    'The hall gate of {town}, by evening, rattling with bone chips. The gate captain grunts. "A goat thief. Do not get ideas. {crypt} eats better than you."',
    'The hall gate of {town}, by evening, the pit rattling behind you. The gate captain spits. "Beaten by a goat thief. Stay out of {crypt}."'));

// The Hollin Reach's first delve (#1013 slice 7a): the one dungeon on that map, at the end of its road. The same small shape; its closing words look to the roads out, not to a great dungeon.
PROLOGUES.push(valeDelve('tithe-grange','Oldstead',0,'ruin','the Tithe Grange','Cellarer Thrupp',
    'The roofless grange at the end of the wood road, {walk} from {town}. The hall sent word to each of you alone: the tithe carts stopped coming back, and hedge-thieves have the undercroft. The road goes no further than this door.',
    'Cellarer Thrupp kept the tithe here for a priory nobody remembers, and when the priory stopped sending for it he stayed and went on counting. He lets the thieves sleep below for a share and keeps their takings in his old ledgers. A small, stubborn, hungry man. The first thing a company ever beats, so let it feel like something.',
    ['Rooks go up from the roofless barn, and something below drops a cask and swears.','Cart ruts run to the cellar door and none run back.'],'Wolf Pelt',
    ['hedgecaller',2],['The Cart Bay','Two hedge-thieves look up from a broken tithe cart, and one of them whistles for help that does not come.'],['tollbreaker',2],['The Undercroft','Stone vaults and stacked grain, and two big men who were told nobody ever comes this far.'],
    'captain','hedgecaller',"The Cellarer's Count",'A stub of candle, a wall of ledgers, and an old man who wants to know what you are bringing and whether you have it in writing.',
    'The hall gate of {town}, by evening, with grain dust on your boots. The gate captain weighs the ledger in one hand. "That is the end of the wood road. The other two have no end anybody here has seen."',
    'The hall gate of {town}, by evening, with the grange still held behind you. The gate captain shuts the wicket. "One old man and a cellar. There are two more roads out of here, and neither is as short as that one."'));
