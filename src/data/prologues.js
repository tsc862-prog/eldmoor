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
