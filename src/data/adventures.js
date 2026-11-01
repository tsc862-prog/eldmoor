// Adventure templates for the DM (issue #63). Pure data, no logic: sim/dm.js turns a hook
// into an adventure, places every scene on a real map point and runs it with dice.
// Owned by ai-designer (structure, numbers) and lore-keeper (voice). Canon: docs/LORE.md,
// "Adventures". Voice: the Chronicler's (third person, present tense, grounded, dry).
//
// Template fields:
//   name      short label for stats and the hero card
//   title     title patterns; {thing} the hook's subject, {place} the destination,
//             {zone} the region, {beast} a named foe
//   things    pool for {thing} (a template may get it from the hook instead: the dead, an elite)
//   size      [min,max] heroes in the party (solo counts as 1)
//   lvl       lowest level of the weakest member
//   givers    townsfolk roles (data/npcs.js ids) who post this kind of job
//   pay       on success, per member: xp (share of xpNeed(level)), gold (x (6 + 3 x level)),
//             honor, gear (chance of a reward item for members other than the leader)
//   follow    template a success may spawn as a follow-up hook
//   scenes    3-5 scene specs, run in order. The last one (or a choice's branch) is final.
//
// Scene spec fields:
//   type   travel | fight | social | trap | rest | choice   (see SCENE_TYPES)
//   at     where it happens: region (a hunting point), road (a road tile away from every
//          gate), landmark (beside a landmark in the region), hook (where the hook came from:
//          a grave, a robbed wagon), home (the leader's gate), dest (another friendly town's
//          gate, the Crypt mouth or a far waymark), here (where the last scene ended)
//   check  which modifier the roll uses (CHECKS); a travel or rest with no check has no roll
//   dc     added to the region's DC
//   foe    fight only: {n:[min,max]} ordinary monsters of the region, or {named:true} for a
//          named foe spawned for the adventure (plus {n} minions)
//   final  the adventure's outcome hangs on this roll
//   frame / pass / fail   line pieces: "{frame}... rolls 14+3 vs 12. {pass|fail}"
//   a / b  choice only: two branches {label, line, scene}; the DM's resolveBranch picks one
//          (a is the bold road, b the careful one) and its scene runs next
//
// Tokens in lines: {who} the leader or "<leader>'s party", {lead} the leader, {thing},
// {place}, {zone}, {town} the home town, {foes} "three Boglings", {beast} the named foe,
// {stranger}, {giver} the townsperson who posted the job, {title}.

// Class bonus per check kind; the party rolls with its best member's level/3 + bonus.
export const CHECKS={
  track:{Hunter:3,Rogue:1,Warrior:1},
  social:{Priest:3,Mage:2},
  lore:{Mage:3,Priest:2,Rogue:1},
  trap:{Rogue:3,Hunter:1},
  fight:{Warrior:2,Hunter:2,Rogue:1},
  watch:{Hunter:2,Warrior:2,Rogue:1},
};

// What each scene type does. check: the default roll. Complications a failed roll may
// bring (the DM's chooseComplication picks one; weights in COMPLICATIONS).
export const SCENE_TYPES={
  travel:{check:null,complications:['late','wound']},
  fight: {check:'fight',complications:['wound']},
  social:{check:'social',complications:['hostile','late']},
  trap:  {check:'trap',complications:['wound','late']},
  rest:  {check:'watch',complications:['ambush']},
  choice:{check:null,complications:[]},
};

// Consequences that carry forward. A failed roll draws one; a natural 20 draws a boon.
// wound: every member loses a share of max HP (never below 1). late: the party loses half
// a day where it stands. hostile: the next social roll is harder and the next fight has
// one more foe. ambush: monsters come out of the dark (a fight is added to this scene).
// boon: the next roll is easier. item: a reward item for everyone on success.
export const COMPLICATIONS={
  wound:{w:3,hp:.18,line:['Nobody comes out of it unbloodied.','It costs blood all round.','Cuts and bruises for everyone.']},
  late:{w:2,wait:[14,22],line:['Half a day is lost.','The light goes before the work is done.','They lose the afternoon to it.']},
  hostile:{w:2,dc:3,line:['Word runs ahead of them; the next door will be shut.','Somebody will remember this, and not kindly.']},
  ambush:{w:1,line:['Then {foes} come out of the dark.','The fire draws {foes}.']},
  boon:{w:1,dc:-2,line:['The next step looks easier.','Luck, for once, is on their side.']},
  item:{w:1,line:['{lead} pockets something worth keeping.','Something glints in the mud; {lead} keeps it.']},
};

// Strangers for social scenes (generic folk, no names).
export const STRANGERS=['peat-cutter','hermit','drover','charcoal-burner','Rookscar deserter','tinker','ferryman','widow with a lantern'];
// Named foes made for an adventure: a name and a title pattern ({zone}, {kind} the species).
export const BEAST_NAMES=['Old Scar','the Grey Widow','Crookback','Longtooth','the Quiet One','Ashjaw','Rimeclaw','Mudmother','Halfhorn','the Pale Hunger','Blackgums','Old Rot'];
export const BEAST_TITLES=['the {kind} nobody hunts twice','terror of the {zone} drovers','the oldest {kind} in {zone}','the {kind} with the broken leash','that the {zone} children sing about'];
// A named foe: formula stats at (highest party level + 1), times these (lower for a solo hero).
export const BEAST={scale:[1.25,1.5],hit:[1,1.15]};

// How the townsfolk post a job. The opening line of every adventure.
export const OFFER={
  writ:['At the gate of {town}, {giver} hands {who} a writ: {title}.','{giver} stops {who} at the {town} gate with a job: {title}.'],
  request:['{giver} of {town} has a favour to ask of {who}: {title}.','{giver} catches {who} in the {town} square. {title}, if they would.'],
  rumour:['By the {town} inn fire, {giver} tells {who} what the drovers saw. {title}.','{giver} leans over the {town} bar: there is talk, and coin, in {title}.'],
  oath:['{lead} hears of a road toward an old oath: {title}.','An oath sends {who} out of {town}: {title}.'],
  death:['{giver} asks {who} to go back for {thing}: {title}.','{thing} died in {zone} with a pack nobody brought home. {giver} asks {who} to fetch it.'],
  remnant:['{giver} wants to know what happened on the {zone} road. {who} takes the job: {title}.','A job on the {zone} road from {giver}: {title}.'],
  follow:['Word of {who}’s last job travels. {giver} has another: {title}.','{giver} has been waiting for {who}: {title}.'],
};
export const RESUME=['{who} sets out from {town} again: {title} is not finished.','{who} goes back out after {title}.'];
export const RETREAT=['{who} falls back toward {town}; {title} will keep.','{who} turns for home, {title} unfinished.'];
export const OUTCOME={
  success:['{who} returns from {title} with the job done.','{title} is done, and done well.','{who} sees {title} through.'],
  partial:['{who} comes back from {title} with half a victory.','{title} ends with a shrug: done, more or less.','{title} is finished, if not the way anyone wanted.'],
  failure:['{title} comes to nothing.','{who} gives up on {title}.','{title} fails, and {town} will hear of it.'],
  death:['{lead} dies with {title} unfinished.','With {lead} dead, {title} dies too.','{title} ends in a grave: {lead} is dead.'],
  abandoned:['{title} is set aside; nobody is left to finish it.','Everyone on {title} has gone another way. It is not finished.'],
  expired:['Three days on, the trail of {title} has gone cold. {who} lets it go.'],
  gone:['{beast} is already dead; someone else got there first. {title} ends without a fight.'],
};
export const NAMED_DOWN=['{beast} goes down at last.','{beast} falls, and does not get up.','{lead} finishes {beast}.'];

export const ADVENTURES={
  rescue:{name:'Rescue',title:['Bring Home {thing}','Missing in {zone}: {thing}'],
    things:['a woodcutter','a shepherd and her dog','the quartermaster’s runner','two charcoal-burners','a lost surveyor','a drover’s boy'],
    size:[1,3],lvl:4,givers:['captain','innkeeper'],pay:{xp:.5,gold:1.2,honor:3,gear:.4},follow:'escort',
    scenes:[
      {type:'travel',at:'region',check:'track',frame:'{who} searches {zone} for {thing}',
        pass:'Fresh tracks, and a scrap of cloth on a thorn.',fail:'The trail splits, and splits again.'},
      {type:'fight',at:'here',foe:{n:[2,3]},frame:'{who} finds {thing} hemmed in by {foes}',
        pass:'{lead} is among them before they turn.',fail:'They were waiting; {lead} takes the first bite.'},
      {type:'choice',frame:'{thing} cannot walk far',
        a:{label:'Straight home through the brush',line:'{who} carries {thing} straight through the brush.',
          scene:{type:'trap',at:'here',check:'trap',frame:'In the brush {who} walks into an old snare-line',pass:'{lead} sees the wire in time.',fail:'The wire bites.'}},
        b:{label:'Camp and wait for daylight',line:'{who} makes camp and waits for daylight.',
          scene:{type:'rest',at:'road',frame:'{who} keeps a fire on the {zone} road',pass:'The night passes quietly.',fail:'Something circles the fire.'}}},
      {type:'travel',at:'home',check:'social',final:true,frame:'{who} brings {thing} to the gate of {town}',
        pass:'The family pays what they can, which is more than they should.',fail:'{thing} lives, and complains about the walk the whole way.'},
    ]},
  escort:{name:'Escort',title:['Escort {thing} to {place}','{Thing} for {place}'],
    things:['a salt wagon','a cart of lamp oil','the chapel’s candle-tithe','an ore sledge','a mule train of grain'],
    size:[1,3],lvl:4,givers:['quartermaster','smith'],pay:{xp:.45,gold:1.5,honor:1,gear:.3},follow:'investigate',
    scenes:[
      {type:'travel',at:'road',frame:'{who} takes {thing} out of {town}'},
      {type:'trap',at:'here',check:'trap',frame:'A felled tree lies across the {zone} road, too neatly',
        pass:'{lead} finds the snare-line before the mules do.',fail:'The snare-line springs; the wagon lurches and so does everyone near it.'},
      {type:'fight',at:'road',foe:{n:[2,3]},frame:'The smell of the wagon draws {foes}',
        pass:'{who} meets them in the road, weapons out.',fail:'They hit the wagon from both sides at once.'},
      {type:'travel',at:'dest',check:'social',final:true,frame:'{who} delivers {thing} at {place}',
        pass:'The tallyman counts every crate and pays in full.',fail:'Two crates short. The tallyman docks the pay and does not apologise.'},
    ]},
  investigate:{name:'Investigate',title:['What Happened on the {zone} Road','The Matter of {thing}'],
    things:['a wagon that never arrived','lights on the road at night','a herd found torn open','a waymark knocked flat','a watch-post gone quiet'],
    size:[1,3],lvl:4,givers:['captain','bard','innkeeper'],pay:{xp:.5,gold:1.1,honor:2,gear:.35},follow:'clear',
    scenes:[
      {type:'travel',at:'hook',check:'lore',frame:'{who} looks over the place where it happened',
        pass:'Boot-prints, and claw-marks over the boot-prints.',fail:'Rain has had the ground first.'},
      {type:'social',at:'region',check:'social',frame:'{who} questions a {stranger} on the edge of {zone}',
        pass:'The {stranger} talks, for a coin, and points.',fail:'The {stranger} spits and walks off.'},
      {type:'choice',frame:'Enough is known to choose a road',
        a:{label:'Follow the claw-marks',line:'{who} follows the claw-marks off the road.',
          scene:{type:'fight',at:'region',foe:{named:true,n:[0,1]},final:true,frame:'At the end of the marks waits {beast}, {btitle}',
            pass:'{lead} strikes first.',fail:'{beast} was expecting them.'}},
        b:{label:'Report what is known',line:'{who} decides to take what they know home.',
          scene:{type:'travel',at:'home',check:'lore',final:true,frame:'{who} lays it all out for {giver} in {town}',
            pass:'{giver} nods slowly: it fits.',fail:'{giver} is not convinced, and pays like it.'}}},
    ]},
  clear:{name:'Clear a lair',title:['Clear the Den in {zone}','Smoke Out the {zone} Den'],
    size:[2,3],lvl:5,givers:['captain','smith'],pay:{xp:.6,gold:1.2,honor:3,gear:.45},follow:'hunt',
    scenes:[
      {type:'travel',at:'region',check:'track',frame:'{who} tracks the pack to its den',
        pass:'The den is where the bones are.',fail:'They find it the long way, by the smell.'},
      {type:'trap',at:'here',check:'trap',frame:'The den mouth is strung with old bones and older snares',
        pass:'{lead} picks a way through.',fail:'Bones rattle; the den knows they are coming.'},
      {type:'fight',at:'here',foe:{n:[2,4]},frame:'{foes} boil out of the den',
        pass:'{who} holds the mouth.',fail:'They come from a second hole.'},
      {type:'fight',at:'here',foe:{named:true,n:[0,0]},final:true,frame:'{beast}, {btitle}, comes out last',
        pass:'{lead} is ready for it.',fail:'It comes out faster than anyone thought.'},
    ]},
  relic:{name:'Recover a relic',title:['Recover {thing}','Lost in {zone}: {thing}'],
    things:['the chapel’s lantern-bell','a bone reliquary','a surveyor’s brass chain','an old banner pole','a sealed tithe box'],
    size:[1,3],lvl:4,givers:['priest','smith','innkeeper'],pay:{xp:.5,gold:1.1,honor:2,gear:.5},follow:'negotiate',
    scenes:[
      {type:'travel',at:'landmark',check:'lore',frame:'{who} looks for {thing} near {place}',
        pass:'Someone buried it carefully, and marked the spot for themselves.',fail:'An afternoon of digging in the wrong places.'},
      {type:'trap',at:'here',check:'trap',frame:'Whoever hid {thing} meant it to stay hidden',
        pass:'{lead} lifts it clear of the needle.',fail:'The needle finds a hand.'},
      {type:'choice',frame:'A scavenger got there first',
        a:{label:'Take it back by force',line:'{who} goes after the scavenger’s camp.',
          scene:{type:'fight',at:'region',foe:{n:[2,3]},frame:'The scavenger’s camp is guarded by {foes}',pass:'{who} goes straight in.',fail:'The camp was ready.'}},
        b:{label:'Buy it back',line:'{who} opens a purse instead.',
          scene:{type:'social',at:'region',check:'social',frame:'{who} haggles with the scavenger',pass:'A fair price, nearly.',fail:'The price doubles while they talk.'}}},
      {type:'travel',at:'home',check:'track',final:true,frame:'{who} carries {thing} home to {town}',
        pass:'Home before dark, nothing dropped.',fail:'It comes home dented.'},
    ]},
  negotiate:{name:'Negotiate',title:['Parley with {thing}','Terms on the {zone} Road'],
    things:['a Rookscar toll-crew','Rookscar deserters','a Rookscar band','the drovers’ guild'],
    size:[1,3],lvl:6,givers:['captain','quartermaster'],pay:{xp:.45,gold:1.6,honor:2,gear:.3},follow:'escort',
    scenes:[
      {type:'travel',at:'road',frame:'{who} goes out to meet {thing}'},
      {type:'social',at:'here',check:'social',dc:1,frame:'{who} parleys with {thing}',
        pass:'Terms are struck, and nobody draws.',fail:'Words run out before patience does.'},
      {type:'choice',frame:'{thing} wants proof of goodwill',
        a:{label:'Clear their road of beasts',line:'{who} agrees to clear the road of beasts.',
          scene:{type:'fight',at:'region',foe:{n:[2,3]},frame:'{foes} have been feeding off the road',pass:'{who} goes in hard.',fail:'The beasts were feeding; they are in no mood to stop.'}},
        b:{label:'Swear on it',line:'{who} offers an oath instead.',
          scene:{type:'social',at:'here',check:'lore',frame:'{who} swears on the old road-law',pass:'{thing} accepts it.',fail:'{thing} laughs at it.'}}},
      {type:'travel',at:'home',check:'social',final:true,frame:'{who} brings the terms to {giver} in {town}',
        pass:'{giver} signs them.',fail:'{giver} reads them twice and signs them anyway, scowling.'},
    ]},
  hunt:{name:'Hunt a named beast',title:['Hunt {beast}','The Hunt for {beast}'],
    size:[2,3],lvl:5,givers:['innkeeper','captain'],pay:{xp:.6,gold:1.2,honor:3,gear:.5},follow:'clear',
    scenes:[
      {type:'travel',at:'region',check:'track',frame:'{who} picks up the trail of {beast} in {zone}',
        pass:'The tracks are fresh and deep.',fail:'The trail goes cold twice before they find it again.'},
      {type:'rest',at:'road',frame:'{who} makes a cold camp and waits for it to move',
        pass:'Nothing stirs till dawn.',fail:'Something stirs before dawn.'},
      {type:'fight',at:'region',foe:{named:true,n:[0,1]},final:true,frame:'{beast}, {btitle}, turns to face them',
        pass:'{lead} gets the first blow in.',fail:'{beast} gets the first blow in.'},
    ]},
  deliver:{name:'Deliver a message',title:['Carry {thing} to {place}','A Message for {place}'],
    things:['a sealed letter','the captain’s writ','a warning about the roads','a ledger','a sick-list for the chapel'],
    size:[1,2],lvl:4,givers:['captain','priest','quartermaster'],pay:{xp:.4,gold:1.2,honor:1,gear:.3},follow:'relic',
    scenes:[
      {type:'travel',at:'road',check:'track',frame:'{who} sets a hard pace along the {zone} road',
        pass:'The miles go quickly.',fail:'A washed-out ford costs them hours.'},
      {type:'social',at:'here',check:'social',frame:'A toll-gate that was not there last week stops {who}',
        pass:'{lead} talks the way through.',fail:'They pay, and argue, and pay.'},
      {type:'travel',at:'dest',check:'social',final:true,frame:'{who} hands {thing} over at {place}',
        pass:'Read, sealed, answered.',fail:'The seal is broken by the time it arrives. Questions are asked.'},
    ]},
  fallen:{name:'Recover the fallen',title:['What {thing} Left Behind','Bring Home {thing}’s Pack'],
    size:[1,3],lvl:4,givers:['priest','innkeeper'],pay:{xp:.45,gold:1,honor:3,gear:.5},follow:null,
    scenes:[
      {type:'travel',at:'hook',check:'track',frame:'{who} finds the place where {thing} fell',
        pass:'The pack is still there, mostly.',fail:'Scavengers have scattered it.'},
      {type:'fight',at:'here',foe:{n:[1,3]},frame:'{foes} have found it first',
        pass:'{who} drives them off the body.',fail:'They do not want to share.'},
      {type:'rest',at:'here',frame:'{who} buries what is left of {thing} and keeps watch',
        pass:'A quiet grave, and a quiet night.',fail:'Something else wants the grave.'},
      {type:'travel',at:'home',check:'social',final:true,frame:'{who} carries {thing}’s gear home to {town}',
        pass:'The chapel rings once for {thing}.',fail:'Nobody comes to claim it.'},
    ]},
};
