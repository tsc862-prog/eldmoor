// The bestiary: stat blocks for every creature (issue #84). Pure data plus the pure functions that
// turn a block into numbers. Owned by creature-designer. The spawn table (zone, level range, sprite,
// palette, trade good, quest) stays in mobs.js `MOBS`; this file says what a creature IS: family, role,
// abilities, resistances, behaviour and loot. Blocks are keyed by the MOBS key; Stepping clones
// (`wolf@3`) resolve to their base species. Elites are a template applied to a base block.
//
// Calibration rule: with the species weighted by COUNTS, the average creature of level L has today's
// formula hp (25 + 16 L) and damage per second ((3 + 2 L) / 1.3). Roles tilt that average (a guardian
// has more hp and bites less) but the mix of roles keeps it level. Ability damage is carved out of the
// base bite, so a creature that breathes or poisons hits less often with its plain attack.
// `scripts/bestiarycheck.mjs` prints and asserts the averages.

// ---- roles ----
// hp, dps: multipliers on the formula. cd: seconds between attacks. crit: chance of a x1.6 hit.
// guard: share of hero damage the creature shrugs off. reach: tiles it can bite from. xp, gold: payout
// multipliers. gear: chance a kill drops a slot item (ordinary kills today: .06). cost: encounter budget.
export const ROLES={
  brute:     {hp:1.20,dps:.95,cd:1.7,crit:.05,guard:.04,reach:1,  xp:1.05,gold:1.1,gear:.06,cost:1.1},
  skirmisher:{hp:.88,dps:1.14,cd:1.0,crit:.12,guard:0,  reach:1,  xp:1.0,gold:1.0,gear:.06,cost:.9},
  caster:    {hp:.80,dps:1.06,cd:2.0,crit:.06,guard:0,  reach:2.4,xp:1.0,gold:1.1,gear:.06,cost:1.0},
  swarm:     {hp:.62,dps:.90,cd:1.0,crit:.04,guard:0,   reach:1,  xp:.8, gold:.7, gear:.04,cost:.5},
  guardian:  {hp:1.42,dps:.82,cd:2.1,crit:.03,guard:.08,reach:1.2,xp:1.1,gold:1.3,gear:.09,cost:1.3},
  leader:    {hp:1.25,dps:1.00,cd:1.4,crit:.08,guard:.04,reach:1.2,xp:1.5,gold:1.5,gear:.14,cost:2.5},
};
export const FAMILIES=['beast','vermin','undead','elemental','brute-folk','bandit','wyrm'];

// ---- damage tags ----
// What hero classes deal, for resistances. Reserved for later: fire, cold (monster breath, wands).
export const DMG_TAGS={Warrior:'physical',Rogue:'physical',Hunter:'nature',Mage:'arcane',Priest:'holy'};
export const TAGS=['physical','arcane','holy','nature','cold','fire'];

// ---- abilities ----
// fx: poison (damage over time), slow / root / fear (the hero loses strikes: its attack timer is pushed
// back by `lose` seconds), knockback (hurled out of reach, must walk back), summon (spawns lesser kin),
// heal (mends a hurt ally), breath (area damage to everyone fighting it), frenzy (self buff).
// cd: seconds. dmg: damage in units of the creature's own bite (3 + 2 L) x its hit multiplier; poison's
// is the total over `dur`. when: the scripted policy: 'engaged' (any time in a fight), 'hurt' (own hp
// below `hp`), 'ally' (a hurt ally mob is near), 'pack' (another of its kind is near).
export const ABILITIES={
  venom:     {name:'Venom',       fx:'poison',   cd:10,dmg:1.2,dur:6,when:'engaged',tag:'nature',txt:'poisons'},
  chill:     {name:'Rime Bite',   fx:'slow',     cd:11,dmg:.2,lose:1.0,when:'engaged',tag:'cold',txt:'chills'},
  mire:      {name:'Mire Grip',   fx:'slow',     cd:12,dmg:0,lose:1.1,when:'engaged',tag:'nature',txt:'drags down'},
  web:       {name:'Web Snare',   fx:'root',     cd:12,dmg:0,lose:1.8,when:'engaged',tag:'nature',txt:'webs'},
  gore:      {name:'Gore',        fx:'knockback',cd:13,dmg:.6,push:2.3,lose:.6,when:'engaged',tag:'physical',txt:'gores'},
  slam:      {name:'Slag Slam',   fx:'knockback',cd:12,dmg:.8,push:2.0,lose:.8,when:'engaged',tag:'physical',txt:'slams'},
  hatch:     {name:'Hatch',       fx:'summon',   cd:40,dmg:.4,n:1,max:2,when:'hurt',hp:.75,tag:'nature',txt:'brings forth kin'},
  howl:      {name:'Howl',        fx:'fear',     cd:16,dmg:0,lose:1.6,when:'pack',tag:'nature',txt:'howls at'},
  mend:      {name:'Mend',        fx:'heal',     cd:14,dmg:.6,amount:.25,when:'ally',tag:'holy',txt:'mends'},
  ashbreath: {name:'Ash Breath',  fx:'breath',   cd:9, dmg:1.0,radius:2.8,when:'engaged',tag:'fire',txt:'breathes ash on'},
  rimebreath:{name:'Rimeblast',   fx:'breath',   cd:10,dmg:.9,radius:2.6,when:'engaged',tag:'cold',txt:'exhales killing frost at'},
  frenzy:    {name:'Frenzy',      fx:'frenzy',   cd:40,dmg:2.8,dur:8,when:'hurt',hp:.45,tag:'physical',txt:'goes into a frenzy'},
  dread:     {name:'Grave Dread', fx:'fear',     cd:15,dmg:.3,lose:2.0,when:'engaged',tag:'holy',txt:'fills with dread'},
  drain:     {name:'Marrow Chill',fx:'poison',   cd:9, dmg:1.0,dur:5,when:'engaged',tag:'cold',txt:'drains'},
  roar:      {name:'Bellow',      fx:'fear',     cd:15,dmg:0,lose:1.4,when:'engaged',tag:'physical',txt:'bellows at'},
};

// ---- species ----
// role, family, abilities (1-3 ids), res / weak: {tag: multiplier on damage taken}, beh: aggro reach in
// tiles (today 1.3), pack (how many others of its kind it calls, within 5 tiles), flee (hp share at which
// it breaks off for a moment), territorial (never ambushes outside its own zone), finishes (strikes a downed hero even when others stand, #626), tilt: {hp,dps} nudges
// that keep each role mix level (see bestiarycheck). loot: p chance of the trade good, gold scale, gear
// chance (defaults to the role's), epic chance of a zone epic.
export const BESTIARY={
  wolf:     {family:'beast',role:'skirmisher',tilt:{dps:1.1},abilities:['howl'],beh:{aggro:1.3,pack:1,flee:.15,finishes:true}},
  boar:     {family:'beast',role:'brute',tilt:{dps:.88},abilities:['gore'],beh:{aggro:1.0}},
  spider:   {family:'vermin',role:'caster',tilt:{dps:.84,hp:.95},abilities:['web','venom'],beh:{aggro:.9},res:{nature:.85},weak:{holy:1.1}},
  bog:      {family:'brute-folk',role:'swarm',tilt:{hp:1.3,dps:1.1},abilities:['mire'],beh:{aggro:1.3,pack:2},weak:{arcane:1.1}},
  mudboar:  {family:'beast',role:'brute',abilities:['frenzy','gore'],beh:{aggro:1.3}},
  lurker:   {family:'vermin',role:'caster',tilt:{hp:1.1},abilities:['venom','hatch'],beh:{aggro:1.3},res:{nature:.8},weak:{arcane:1.15}},
  golem:    {family:'elemental',role:'guardian',tilt:{hp:.8},abilities:['slam'],beh:{aggro:1.1},res:{physical:.9},weak:{arcane:1.2}},
  drake:    {family:'wyrm',role:'caster',tilt:{hp:1.2,dps:1.1},abilities:['ashbreath'],beh:{aggro:1.4},res:{arcane:.9},weak:{physical:1.1}},
  rimehound:{family:'beast',role:'skirmisher',abilities:['chill','howl'],beh:{aggro:1.5,pack:2,flee:.15,finishes:true},weak:{arcane:1.1}},
  shaghorn: {family:'beast',role:'brute',abilities:['roar','gore'],beh:{aggro:1.0},res:{physical:.92}},
  wight:    {family:'undead',role:'caster',tilt:{dps:.96},abilities:['drain','dread'],beh:{aggro:1.3,finishes:true},res:{nature:.85},weak:{holy:1.3}},
};

// ---- site foes ----
// Creatures that live in dungeons, camps and ruins rather than on the open field. They have no row in
// MOBS (so no quests and no field spawns); they borrow a field species' sprite and palette (`base`) and
// are spawned by the encounter builder and the DM. lv: the levels they appear at. themes: where.
export const VARIANTS={
  shambler:   {name:'Crypt Shambler', pl:'Crypt Shamblers', base:'wight', family:'undead',   role:'brute',     abilities:['dread'],        lv:[5,22],res:{nature:.85},weak:{holy:1.3},themes:['crypt','temple','ruin']},
  boneshot:   {name:'Bone Archer',    pl:'Bone Archers',    base:'wight', family:'undead',   role:'caster',    abilities:['drain'],        lv:[5,22],res:{nature:.85},weak:{holy:1.3},themes:['crypt','temple','ruin']},
  tombskit:   {name:'Tomb Skitter',   pl:'Tomb Skitters',   base:'spider',family:'vermin',   role:'swarm',     abilities:['venom'],        lv:[3,20],weak:{holy:1.1},themes:['crypt','mine','ruin','den']},
  graveward:  {name:'Grave Warden',   pl:'Grave Wardens',   base:'wight', family:'undead',   role:'guardian',  abilities:['dread','mend'], lv:[7,22],res:{physical:.9},weak:{holy:1.25},themes:['crypt','temple']},
  reedcutter: {name:'Reedcutter',     pl:'Reedcutters',     base:'bog',   family:'bandit',   role:'skirmisher',abilities:['frenzy'],       lv:[3,22],themes:['fortress','road','ruin']},
  tollbreaker:{name:'Tollbreaker',    pl:'Tollbreakers',    base:'bog',   family:'bandit',   role:'brute',     abilities:['gore'],         lv:[3,22],themes:['fortress','road']},
  hedgecaller:{name:'Hedge Caller',   pl:'Hedge Callers',   base:'bog',   family:'bandit',   role:'caster',    abilities:['mend','venom'], lv:[4,22],weak:{arcane:1.1},themes:['fortress','road','den']},
  captain:    {name:'Camp Captain',   pl:'Camp Captains',   base:'bog',   family:'bandit',   role:'leader',    abilities:['roar','frenzy'],lv:[4,22],themes:['fortress']},
  slagmote:   {name:'Slag Mote',      pl:'Slag Motes',      base:'golem', family:'elemental',role:'swarm',     abilities:['ashbreath'],    lv:[8,22],res:{physical:.9},weak:{arcane:1.2},themes:['mine','temple']},
  cavecrawler:{name:'Cave Crawler',   pl:'Cave Crawlers',   base:'spider',family:'vermin',   role:'skirmisher',abilities:['venom','web'],  lv:[3,20],themes:['mine','den']},
  denmother:  {name:'Den Mother',     pl:'Den Mothers',     base:'wolf',  family:'beast',    role:'leader',    abilities:['howl','frenzy'],lv:[1,22],themes:['den']},
};

// ---- elite template ----
// Named rare elites are their base block times this, plus one extra ability and guaranteed loot.
// (ELITES rows in mobs.js carry the same scale and hit; the check script asserts they agree.)
export const ELITE_TEMPLATE={hp:2.2,dmg:1.5,regen:.01,aggro:2.2,gear:1,epic:1}; // gear, epic: guaranteed drops (killMob)
export const ELITE_EXTRA={ // the one extra ability each named elite carries
  'Hollowfang':'frenzy','Old Mother Sedge':'hatch','Scoriath':'roar','Ulfryn Coldmarrow':'rimebreath',
  'Brask Ironhorn':'gore','Whitemaw':'rimebreath'};

// ---- named foes made for an adventure ----
// The DM's named foe: one monster of the region raised to the party's top level + 1, role leader, with a
// signature ability on top of its kin's. Scale and hit come from adventures.js BEAST.
export const NAMED_KITS={
  'Old Notch':['frenzy'],'the Grey Widow':['web'],'Crookback':['gore'],'Longtooth':['howl'],'the Quiet One':['dread'],
  'Ashjaw':['ashbreath'],'Rimeclaw':['chill'],'Mudmother':['mire'],'Halfhorn':['roar'],'the Thin Hunger':['drain'],
  'Blackgums':['venom'],'Old Rot':['hatch']};

// ---- block assembly ----
const abilityShare=ids=>{let s=0;for(const id of ids){const a=ABILITIES[id];if(a)s+=a.dmg/a.cd}return s*1.3};
export const baseId=type=>String(type).split('@')[0];
const cache=new Map();
// The full block for a creature: role numbers merged with species data. `variant` is a VARIANTS key;
// `type` is the MOBS key it is spawned as (its sprite). Cached; treat the result as read-only.
export function blockOf(type,variant,role){
  const key=(variant||'')+'|'+type+'|'+(role||''),hit=cache.get(key);if(hit)return hit;
  const sp=variant?VARIANTS[variant]:BESTIARY[baseId(type)];if(!sp)throw new Error('bestiary: no block for '+type+(variant?' / '+variant:''));
  const R=ROLES[role||sp.role],til=role?{}:sp.tilt||{},abil=sp.abilities.slice(0,3),share=abilityShare(abil);
  const dps=Math.max(.35,R.dps*(til.dps||1)-share),b={
    id:variant||baseId(type),family:sp.family,role:role||sp.role,abilities:abil,res:sp.res||{},weak:sp.weak||{},
    hp:R.hp*(til.hp||1),hit:dps*R.cd/1.3/(1+.6*R.crit),cd:R.cd,crit:R.crit,guard:R.guard,reach:R.reach,xp:R.xp,cost:R.cost,
    beh:Object.assign({aggro:1.3,pack:0,flee:0,territorial:true},sp.beh||{}),
    loot:Object.assign({p:.72,epic:.006},{gold:R.gold,gear:R.gear},sp.loot||{})};
  if(variant){b.name=sp.name;b.pl=sp.pl;b.base=sp.base;b.lv=sp.lv;b.themes=sp.themes}
  cache.set(key,b);return b}

// Damage multiplier a creature takes from a damage tag (resistances below 1, weaknesses above).
export const tagMul=(res,weak,tag)=>((res&&res[tag])||1)*((weak&&weak[tag])||1);
export const heroTag=cls=>DMG_TAGS[cls]||'physical';

// Crafting materials a creature may leave beside its trade good (issue #256, epic #238). Rows keyed by the MOBS key
// (Stepping clones resolve through baseId); `p` is the chance per kill, `skinning` marks hide a Skinner takes from the
// body (others drop whole). Data only: loot.js reads it when gathering lands (#257). Materials live in items.js MATERIALS.
export const MAT_DROPS={
  wolf:     {id:'Wolf Sinew',      p:.25,skinning:true},
  mudboar:  {id:'Mudback Bristle', p:.25,skinning:true},
  shaghorn: {id:'Shaghorn Horn',   p:.2, skinning:true},
  bog:      {id:'Mere Eel',        p:.15},
  golem:    {id:'Cinderite',       p:.3}};
