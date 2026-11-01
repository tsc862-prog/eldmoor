// Townsfolk: the roles every town staffs, how each looks, when it keeps its post and
// what it says. Pure data. Roles and palettes are owned by character-builder, the
// lines by lore-keeper; sim/npcs.js gives each town one NPC per role, named from the
// town's people (data/races.js), and runs their day. Canon: docs/LORE.md, "Townsfolk".
//
// Each role: {id, title:[concord,warband], post (a town spot from the world spec:
//   inn, smith, quartermaster, chapel, square, gate), spr (SPR key in render/sprites.js),
//   hours:[open,close] by game hour (null = always at post; close<open wraps midnight),
//   pal:[concord,warband] sprite colours (R body, A accent, M metal, W tool, H hood/cap
//   where the role covers the hair), lines:{trigger:[concordLines,warbandLines]}}.
// Placeholders: {target} the hero spoken to, {town} this town, {name} the speaker,
// and for the bard's songs {hero}, {elite}, {zone}. Voice: Concord formal and dry,
// Warband blunt and loud. Every line is original to Eldmoor.
// Triggers: greet (a hero within two tiles of the post), open and close (arriving at
// and leaving the post), bless (priest, a Crypt party), song and songFoe (bard, a named
// elite slain by a hero of this or the other faction), boss and bossFoe (bard, Kragmaw).

export const NPC_ROLES=[
  {id:'innkeeper',title:['Innkeeper','Mead-keeper'],post:'inn',spr:'innkeeper',hours:[8,24],
    pal:[{R:'#7a5a3a',A:'#e8e0c8',M:'#c8c0a0',W:'#b89050'},{R:'#5a3a2a',A:'#a89078',M:'#c8c0a0',W:'#8a7050'}],
    lines:{
      greet:[
        ['Welcome back, {target}. The fire is lit and the stew is yesterday\'s, which is when it was best.',
         'A bed for {target}? Clean sheets, mostly. The snoring is extra.',
         'You look footsore, {target}. Sit. The ledger can wait; the ale cannot.',
         'Still alive, {target}. I had a wager on it. Thank you for that.'],
        ['{target}! Drink first, boast second. Those are the rules in here.',
         'Mind the floor, {target}. Someone bled on it and I have not decided whose it was.',
         'Mead is two coppers. Stories are free, if they are good.',
         'If you die out there, {target}, settle your tab first. I mean it.']],
      open:[['Doors open. Mind the step and the dog.'],['Open! Come in or get out of the way.']],
      close:[['Last candle. Finish up, friends.'],['Out. Sleep somewhere else.']]}},
  {id:'smith',title:['Smith','Forge-master'],post:'smith',spr:'smith',hours:[6,21],
    pal:[{R:'#6a6a7a',A:'#4a3a2a',M:'#c8ccd4',W:'#8a6a3a'},{R:'#5a4a40',A:'#3a2a20',M:'#b8bcc4',W:'#7a5a30'}],
    lines:{
      greet:[
        ['That edge wants work, {target}. Leave it an hour and it will remember what it is for.',
         'That is a fine dent, {target}. Did you win the argument?',
         'Steel does not care who holds it. Hold it well anyway.',
         'I can mend the plate. The pride you will have to mend yourself.'],
        ['Hit harder, {target}, and I will have to make it thicker.',
         'Bring me the teeth of whatever did this and I will set them in the hilt.',
         'Iron, fire, muscle. Everything else is talk.',
         'That blade is tired, {target}. So are you. Only one of you I can fix.']],
      open:[['Forge is hot. Bring me your troubles in metal.'],['Fire is up. Bring iron or go away.']],
      close:[['Banking the coals. Tomorrow, then.'],['Fire is down. Hit things with what you have.']]}},
  {id:'quartermaster',title:['Quartermaster','Quartermaster'],post:'quartermaster',spr:'quartermaster',hours:[6,21],
    pal:[{R:'#b8862a',A:'#6a4a1a',M:'#f2c14e',W:'#8a6a3a'},{R:'#b8862a',A:'#4a2a1a',M:'#f2c14e',W:'#6a4a2a'}],
    lines:{
      greet:[
        ['Goods on the table, {target}. I weigh fair and I count twice.',
         'Pelts, fangs, oddments. Name a price and I shall name a better one.',
         '{town} buys what {town} needs. The rest I take as a kindness to you.',
         'Your coin is good here, {target}. Your credit is a longer conversation.'],
        ['Show me the haul, {target}. Bones and skins, not stories.',
         'I pay in coin, not in praise. You want praise, find the singer.',
         'Everything on this table has killed something. Pick carefully.',
         'You sold me this last week, {target}. It was broken then too.']],
      open:[['Market is open. Honest weights, honest words.'],['Table is open. No haggling before noon.']],
      close:[['Closing the books. Whatever you found can wait till dawn.'],['Done for the day. Keep your rubbish till morning.']]}},
  {id:'priest',title:['Priest','Shaman'],post:'chapel',spr:'priest',hours:[6,21],
    pal:[{R:'#e8e0d0',A:'#5b8ff2',M:'#f2d890',W:'#8a7050',H:'#c8c0b0'},{R:'#4a3a3a',A:'#e8544a',M:'#e8e0c8',W:'#6a4a30',H:'#7a3a24'}],
    lines:{
      greet:[
        ['Go with a lamp lit, {target}. And come back.',
         'A candle burns for every name that leaves the gate. Yours is lit.',
         'Fear is a tithe, {target}. Pay it and move on.',
         'Bury nothing you can carry home. Carry home everyone you can.'],
        ['The ancestors are watching, {target}. Try to be interesting.',
         'Blood in the ash, breath in the wind. Waste neither.',
         'You smell of smoke and fear, {target}. Keep the smoke.',
         'Die well or do not die. The spirits accept both.']],
      bless:[
        ['The Crypt is cold and keeps what it takes. Go warm, {target}. Go blessed.',
         'Kneel a moment, {target}. There. Whatever waits below, you do not face it alone.',
         'May the water lie still for you under the earth, {target}.'],
        ['Ancestors, mark {target}. If this one falls, make it loud.',
         'Ash on the brow, {target}. Vesk will know who sent you.',
         'Spit, salt and a word, {target}. Now go and break the dead.']],
      open:[['The chapel is open. Come as you are.'],['The circle is drawn. Speak or be quiet.']],
      close:[['Lamps out. The dead keep their own hours.'],['The spirits sleep. So do I.']]}},
  {id:'bard',title:['Bard','Boast-singer'],post:'square',spr:'bard',hours:[6,21],
    pal:[{R:'#6a4a8a',A:'#3a8a5a',M:'#e8d8a0',W:'#a07040'},{R:'#8a3a2a',A:'#2a2a2a',M:'#e8d8a0',W:'#7a5030'}],
    lines:{
      greet:[
        ['A verse for {target}? I only charge if it is any good.',
         'Hold still, {target}, you have the face of a second chorus.',
         'Every scar is a line, {target}. You are becoming quite the ballad.',
         'I have rhymed worse names than yours, {target}. Barely.'],
        ['{target}! Give me a kill worth drumming about.',
         'Nobody sings of the careful, {target}. Remember that.',
         'I have a verse for your death ready, {target}. Keep disappointing me.',
         'Louder lives, longer songs. Yours is a short one so far, {target}.']],
      song:[
        ['Hear it, {town}: {hero} has brought down {elite} in {zone}. I am adding a verse.',
         'A new song tonight: {elite} is dead, and {hero} did the deed in {zone}.',
         '{hero}, {elite}, {zone}: three names, one morning, and the beast\'s is the one struck out.'],
        ['{hero} broke {elite} in {zone}! Drums! Somebody find the drums!',
         'Sing it ugly and sing it loud: {elite} is meat, and {hero} is the knife.',
         '{elite} ate {zone} for years. {hero} ate it in a morning.']],
      songFoe:[
        ['Grim news set to a tune: {elite} fell in {zone} to {hero} of the Warband. We shall have to do better.',
         'The Warband\'s {hero} slew {elite}. I record it plainly and sing it quietly.',
         '{elite} is dead by a Warband hand, {hero}\'s. The verse is short and so is my patience.'],
        ['The Concord\'s {hero} killed {elite} in {zone}. Fine. The next one is ours.',
         'Some soft-hand called {hero} took {elite}. I will not sing that twice.',
         '{elite} fell to the Concord. {hero}, they say. Drums stay quiet tonight.']],
      boss:[
        ['Kragmaw is down! {hero} and the raiders of the Concord have done what the songs said could not be done.',
         'The Cinder Wyrm is slain and {hero} stood in its fire. This one I sing for free.',
         'Write it on the gate: Kragmaw fell, and {hero} led the Concord to it.'],
        ['KRAGMAW IS DEAD. {hero} and the Warband did it. Drink until you forget your own names!',
         'The wyrm fell to {hero}\'s raid. The mountain is ours and so is the song.',
         'Kragmaw! Dead! {hero} did it! Beat the drums until they break!']],
      bossFoe:[
        ['The Warband\'s raid under {hero} has slain Kragmaw. A great deed. A great pity it was theirs.',
         'Kragmaw is dead and the Warband did it, {hero} at the front. I shall sing it correctly and without joy.'],
        ['The Concord killed Kragmaw. {hero} led them. I would spit, but I am saving it.',
         'Soft-hands took the wyrm. {hero}. Remember the name so we can beat it.']],
      open:[['Tuning up. Requests are taken and ignored.'],['Drums out. Bring me something to shout about.']],
      close:[['That is the set. Hum it home.'],['Done singing. Go bleed somewhere else.']]}},
  {id:'captain',title:['Gate Captain','Gate Warden'],post:'gate',spr:'captain',hours:null,
    pal:[{R:'#5b8ff2',A:'#2a4fa0',M:'#c8ccd4',W:'#8a6a3a'},{R:'#e8544a',A:'#8a2420',M:'#9a9ea8',W:'#6a4a2a'}],
    lines:{
      greet:[
        ['Writs, {target}. Mine to read, yours to carry. The trouble is beyond the gate.',
         'Report, {target}. Short words; I have a long watch.',
         'The road is quiet, which is how I like it and how it never stays.',
         'Back on your feet, {target}. Good. The wall counts on it.'],
        ['{target}. You went out. You came back. That is the whole of my report.',
         'Need work? Something out there needs killing. Something always does.',
         'Wipe your boots, {target}. The blood I mean, not the mud.',
         'The gate shuts for nobody. Walk out when you like; walk back if you can.']]}},
];

// People the DM places outside the town rosters (sim/levers.js create_npc): visitors, camp
// folk and road people. Same shape as NPC_ROLES, but no town staffs them and they keep no
// hours. Triggers: greet (neutral or friendly), wary, hostile (the DM set them against the
// hero, the party or the faction). One pool for both factions; the neutral palette is pal[0].
export const WANDER_ROLES=[
  {id:'peddler',title:['Peddler','Peddler'],post:'square',spr:'quartermaster',hours:null,
    pal:[{R:'#7a6a4a',A:'#4a3a2a',M:'#c8c0a0',W:'#8a6a3a'},{R:'#6a5a3a',A:'#3a2a1a',M:'#b8b090',W:'#7a5a30'}],
    lines:{greet:[['Needles, nails, a lucky button. Looking costs nothing, {target}.','Every road leads to a customer. Today it led to you.']],
      wary:[['I have nothing worth stealing, {target}. Walk on.']],
      hostile:[['Not you. Your coin smells of trouble, {target}.','I sell to anyone. Anyone else.']]}},
  {id:'hermit',title:['Hermit','Hermit'],post:'square',spr:'priest',hours:null,
    pal:[{R:'#5a5a4a',A:'#3a3a2a',M:'#a8a890',W:'#6a5a3a'},{R:'#4a4a3a',A:'#2a2a1a',M:'#98988a',W:'#5a4a2a'}],
    lines:{greet:[['The moss grows north here. Remember that, {target}, and you will not get lost.','Sit, if you like. I have been talking to the stones; they are poor company.']],
      wary:[['Keep your distance and your voice down.']],
      hostile:[['Go back the way you came, {target}. The quiet was mine first.','I know your kind. Loud boots and short memories.']]}},
  {id:'drover',title:['Drover','Drover'],post:'square',spr:'innkeeper',hours:null,
    pal:[{R:'#6a4a3a',A:'#c8b890',M:'#c8c0a0',W:'#8a6a3a'},{R:'#5a3a2a',A:'#a89878',M:'#b8b090',W:'#7a5a30'}],
    lines:{greet:[['Mind the herd, {target}. They bite, and so do I.','The beasts are restless tonight. Something on the wind.']],
      wary:[['Stay clear of the animals. They do not like strangers. Nor do I.']],
      hostile:[['You spooked the herd last time, {target}. Keep walking.','Touch my beasts and you will be walking home lighter.']]}},
  {id:'sellsword',title:['Sellsword','Sellsword'],post:'gate',spr:'captain',hours:null,
    pal:[{R:'#4a4a5a',A:'#2a2a3a',M:'#a8acb4',W:'#5a4a3a'},{R:'#5a3a3a',A:'#3a1a1a',M:'#9a9ea8',W:'#4a3a2a'}],
    lines:{greet:[['Need a blade, {target}? Mine is cheap and mostly honest.','Quiet road. I hate a quiet road.']],
      wary:[['Hands where I can see them, {target}.']],
      hostile:[['I remember your face, {target}. Next time I will remember it with steel.','Walk past. Slowly.']]}},
  {id:'minstrel',title:['Minstrel','Minstrel'],post:'square',spr:'bard',hours:null,
    pal:[{R:'#6a3a6a',A:'#e8c060',M:'#c8ccd4',W:'#8a5a2a'},{R:'#7a3a3a',A:'#d8a040',M:'#b8bcc4',W:'#7a4a2a'}],
    lines:{greet:[['A song for the road, {target}? It has a chorus. You will hate it by the end.','Tell me something brave and I will make it braver.']],
      wary:[['I sing about heroes. I am not yet sure which one you are.']],
      hostile:[['There is a verse about you, {target}. You will not like the rhyme.','Coins in the hat or out of my light.']]}},
  {id:'stranger',title:['Stranger','Stranger'],post:'square',spr:'smith',hours:null,
    pal:[{R:'#3a3a3a',A:'#2a2420',M:'#8a8a8a',W:'#5a4a3a'},{R:'#3a2a2a',A:'#241a18',M:'#7a7a7a',W:'#4a3a2a'}],
    lines:{greet:[['Fair day. Or near enough.','You are a long way from a warm fire, {target}.']],
      wary:[['I am only passing through. So are you.']],
      hostile:[['Last time we spoke, {target}, it went badly. It can go worse.','Keep walking. I have not forgotten.','You again. The road is not wide enough for both of us.']]}},
];

const byId={};for(const r of NPC_ROLES.concat(WANDER_ROLES))byId[r.id]=r;
export const npcRole=id=>byId[id];
