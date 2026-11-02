// Hero classes: base stats, attack range and sprite palette. Owned by character-builder.
// hp, atk: base Health and Attack. def: share of every blow turned aside by training (Warrior plate
// drill), folded into Defense with item armor by sim/stats.js. crit: own crit chance (else 8%). spd: swing
// rate multiplier (default 1). heal: casts heals. range: tiles.
export const CLS={
  Warrior:{hp:62,atk:7,range:1.1,acc:'#c0c4d4',head:'#8a8e9c',wep:'#d8dce8',def:.2},
  Mage:{hp:40,atk:10,range:3.2,acc:'#6fc3ff',head:'#3a5ab8',wep:'#8a5a32',orb:'#8ad8ff'},
  Hunter:{hp:48,atk:8,range:3.5,acc:'#7dbb4a',head:'#4e6e2c',wep:'#8a5a2a'},
  Priest:{hp:46,atk:6,range:2.6,acc:'#f0ecd8',head:'#e8e0c0',wep:'#f0e6b0',orb:'#ffe68a',heal:true},
  Rogue:{hp:50,atk:8,range:1.1,acc:'#e6d24a',head:'#2e2a30',wep:'#c8c8d0',crit:.25},
  // Skald (#83): a war-singer. Middling health and reach; the voice is the weapon (party-wide wards and marks).
  Skald:{hp:45,atk:7,range:2.8,acc:'#e0709c',head:'#6e3a62',wep:'#c8964a',orb:'#f0d070'},
};
export const CLSN=Object.keys(CLS);

// Specialisations (issue #82): at level SPEC_LVL a hero takes one of two paths for their class. A path adds
// score points (abil), trains one more skill (skill), brings a passive and one more active ability (rows in
// data/moves.js carrying spec:<id>), and is recorded on the hero as a.spec. Scripted heroes choose by trait
// leanings (lean: trait -> weight) and by what their party lacks (fills: the role the path covers);
// AI-brain and agent heroes choose themselves (tool choose_specialisation). Owned by character-builder.
export const SPEC_LVL=10;
export const SPECS={
  warden:{name:'Warden',cls:'Warrior',fills:'guard',abil:{grit:1,presence:1},skill:'empathy',lean:{Cautious:2,Loyal:2,Pious:1},
    desc:'Stands between the party and harm. Sturdier, and can cover a friend with the shield.'},
  reaver:{name:'Reaver',cls:'Warrior',fills:'damage',abil:{brawn:1,reflex:1},skill:'tracking',lean:{Reckless:2,Boastful:2,Vengeful:1},
    desc:'Trades safety for speed of killing. Hits harder and cuts through crowds.'},
  runescribe:{name:'Runescribe',cls:'Mage',fills:'damage',abil:{wits:1,reflex:1},skill:'perception',lean:{Boastful:2,Reckless:1},
    desc:'Writes the great runes: a fiercer first strike and a second lance close behind the first.'},
  rimekeeper:{name:'Rimekeeper',cls:'Mage',fills:'control',abil:{wits:1,grit:1},skill:'survival',lean:{Cautious:2,Loyal:1},
    desc:'Binds the foe in frost and keeps the party from being reached. Hardier, and holds one foe still.'},
  stalker:{name:'Stalker',cls:'Hunter',fills:'damage',abil:{insight:1,reflex:1},skill:'traps',lean:{Loner:2,Greedy:1,Boastful:1},
    desc:'The patient single shot: better crits and one heartseeking arrow.'},
  trapper:{name:'Trapper',cls:'Hunter',fills:'control',abil:{wits:1,insight:1},skill:'lore',lean:{Cautious:2,Loyal:1},
    desc:'Sows the ground with thorn and cord: steadier on its feet and snares a whole pack at once.'},
  battlecleric:{name:'Battle-Cleric',cls:'Priest',fills:'damage',abil:{brawn:1,presence:1},skill:'athletics',lean:{Reckless:1,Vengeful:2,Boastful:1},
    desc:'Carries the faith into the fight: hardier, harder-hitting, with a branding blow.'},
  mender:{name:'Mender',cls:'Priest',fills:'heal',abil:{insight:1,presence:1},skill:'empathy',lean:{Pious:3,Cautious:1,Loyal:1},
    desc:'Gives everything to the wounded: stronger healing and a swift mending touch for one friend.'},
  cutthroat:{name:'Cutthroat',cls:'Rogue',fills:'damage',abil:{reflex:1,brawn:1},skill:'perception',lean:{Reckless:2,Greedy:1,Vengeful:1},
    desc:'Lives for the opening: a deadlier first blow and a backstab that finds the gap.'},
  trickster:{name:'Trickster',cls:'Rogue',fills:'control',abil:{wits:1,presence:1},skill:'lore',lean:{Cautious:2,Loner:1,Boastful:1},
    desc:'Wins by misdirection: seldom where the blow lands, and a dirty trick that leaves a foe open.'},
  warchanter:{name:'Warchanter',cls:'Skald',fills:'damage',abil:{presence:1,brawn:1},skill:'intimidation',lean:{Reckless:2,Boastful:2,Vengeful:1},
    desc:'Sings the fight forward: a rolling chant that bites every foe nearby, and a louder opening verse.'},
  soothsinger:{name:'Soothsinger',cls:'Skald',fills:'heal',abil:{presence:1,insight:1},skill:'healing',lean:{Loyal:2,Pious:1,Cautious:1},
    desc:'Sings the party back together: a lullaby that mends the whole company and a steadier voice.'},
};
export const CLASS_SPECS={};
for(const id in SPECS)(CLASS_SPECS[SPECS[id].cls]||(CLASS_SPECS[SPECS[id].cls]=[])).push(id);
