// Ability scores and skills: data only. Owned by character-builder; the rolling, modifiers and
// checks live in sim/abilities.js. Names are original and recorded in docs/LORE.md under
// "Abilities and skills".
//
// Six scores run 3-18 at recruitment (4d6, drop the lowest, arranged by class priority) and
// grow at levels 5/10/15/20. Modifier = floor((score - 10) / 2).

// id -> {name, short, desc}. These are the only attributes: items add to them (item.bonus, data/items.js).
export const ABILITIES={
  brawn:   {name:'Brawn',   short:'BRN',desc:'Raw strength: blows, climbing, shouldering doors and men.'},
  reflex:  {name:'Reflex',  short:'RFX',desc:'Quickness of hand and foot: aim, balance, the knife in the dark.'},
  grit:    {name:'Grit',    short:'GRT',desc:'Stamina and stubbornness: hit points, marches, poison, cold.'},
  wits:    {name:'Wits',    short:'WIT',desc:'Learning and cunning: lore, locks, spellcraft, sums.'},
  insight: {name:'Insight', short:'INS',desc:'Reading the land and the people on it: senses, tracks, wounds.'},
  presence:{name:'Presence',short:'PRS',desc:'Force of personality: bargaining, faith, the voice that carries.'},
};
export const ABIL_IDS=Object.keys(ABILITIES);

// Class priorities. The primary score also drives attack; the secondary is the next-best roll.
export const CLASS_ABIL={
  Warrior:{primary:'brawn',  secondary:'grit'},
  Mage:   {primary:'wits',   secondary:'insight'},
  Hunter: {primary:'reflex', secondary:'insight'},
  Priest: {primary:'insight',secondary:'presence'},
  Rogue:  {primary:'reflex', secondary:'wits'},
};
// Each people's small lean (+1 to one score) lives on the race row as `abil` (data/races.js).

// Skills: id -> {name, abil (the score it keys to), desc}.
export const SKILLS={
  tracking:    {name:'Tracking',    abil:'insight', desc:'Follow a trail, read a print.'},
  stealth:     {name:'Stealth',     abil:'reflex',  desc:'Pass unseen and unheard.'},
  traps:       {name:'Traps',       abil:'wits',    desc:'Spot, spring and disarm snares, locks and needles.'},
  persuasion:  {name:'Persuasion',  abil:'presence',desc:'Bargain, parley and plead.'},
  intimidation:{name:'Intimidation',abil:'brawn',   desc:'Make the other party want to be elsewhere.'},
  lore:        {name:'Lore',        abil:'wits',    desc:'Old law, old stories, old marks.'},
  healing:     {name:'Healing',     abil:'insight', desc:'Bind, mend and keep alive.'},
  athletics:   {name:'Athletics',   abil:'brawn',   desc:'Run, climb, haul and break away.'},
  survival:    {name:'Survival',    abil:'grit',    desc:'Weather, forage and the long road.'},
  perception:  {name:'Perception',  abil:'insight', desc:'Notice the thing that is about to happen.'},
};
export const SKILL_IDS=Object.keys(SKILLS);

// Skills a class is trained in (3-4 each).
export const CLASS_SKILLS={
  Warrior:['athletics','intimidation','survival','perception'],
  Mage:   ['lore','traps','persuasion'],
  Hunter: ['tracking','survival','stealth','perception'],
  Priest: ['healing','persuasion','lore','perception'],
  Rogue:  ['stealth','traps','intimidation','persuasion'],
};

// The trade a recruit worked before arms (data/origins.js TRADES) trains one more skill.
export const TRADE_SKILL={
  'miller':'athletics','tanner':'survival','scribe':'lore','drover':'tracking','smith’s apprentice':'traps','cooper':'athletics',
  'chandler':'persuasion','ferryman':'perception','net-mender':'traps','hedge-warden':'tracking',
  'bone-carver':'lore','pit-fighter':'intimidation','skinner':'survival','trapper':'traps','whelp-minder':'healing',
  'salt-boiler':'healing','gully-runner':'stealth',
};

// A trait nudges a skill by +1 (not training): the temperament shows in how they do it.
export const TRAIT_SKILL={
  Cautious:['perception'],Greedy:['traps'],Reckless:['intimidation'],Boastful:['intimidation'],Vengeful:['tracking'],
  Pious:['healing'],Loyal:['persuasion'],Loner:['stealth','survival'],
};
// Which way a hero argues when a scene is social: traits that lean on the fist or on the tongue.
export const SOCIAL_LEAN={intimidation:['Reckless','Boastful','Vengeful'],persuasion:['Pious','Loyal','Cautious','Greedy']};

// Proficiency bonus by level (trained skills); untrained skills get half, rounded down.
export const profBonus=l=>l>=15?5:l>=10?4:l>=5?3:2;
// Score growth at these levels: +1 to the primary, and half the time +1 to the secondary.
export const GROWTH_LEVELS=[5,10,15,20];
export const SCORE_MAX=20;
