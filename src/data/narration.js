// The Chronicler's line templates. Pure data, no logic: sim/narrator.js picks a template
// and fills the {tokens}. Voice: third person, present tense, grounded, dry; never breaks
// the fourth wall, never jokes about respawns. Owned by lore-keeper (voice) and
// ai-designer (triggers). Canon and samples: docs/LORE.md, "The Chronicler".
//
// Tokens: {who} the hero or "<leader>'s party"; {zone} the zone name; {wx} a lower-case
// weather clause ("fog closes in"); {mob} a monster's name with article ("a Fen Lurker");
// {Mob}/{the} the same with a capital or a definite article; {elite} and {title} a named
// elite; {dmg} a number; {hero} a hero.

// Zone entry after dark under a clear sky.
import {WORDS} from '../world/words.js';
export const NIGHT=[
  'Night falls on {zone}; {who} presses on by lantern light.',
  'The last light leaves {zone}. {who} does not turn back.',
  'Dark comes early to {zone}. {who} keeps walking.',
  'Stars over {zone}, and nothing friendly beneath them. {who} presses on.',
  'The road into {zone} goes black behind {who}. Ahead, something is awake.',
];
// Zone entry in daylight under weather. {wx} is the clause from WX.
export const WEATHER_DAY=[
  '{wx} over {zone}; {who} presses on regardless.',
  '{wx} over {zone}. {who} pulls a hood up and goes in.',
  '{who} enters {zone} as {wx}. Nobody suggests waiting.',
];
// Zone entry after dark under weather.
export const WEATHER_NIGHT=[
  'Night falls on {zone} as {wx}; {who} presses on.',
  'Dark and {wx} over {zone}. {who} goes in anyway.',
  'No moon over {zone} tonight, and {wx}. {who} keeps to the road.',
];
// Weather clauses, lower case, by weather kind (sim/weather.js WEATHER keys). Sentence-start
// capitalisation is handled by the narrator.
export const WX={
  drizzle:'a thin drizzle hangs',
  rain:'rain hammers down',
  fog:'fog closes in',
  ashfall:'grey ash sifts down',
  ashstorm:'an ash storm rakes the rock',
  snow:'snow thickens',
  squall:'a squall tears across the ice',
};

// Scout check: a hero ambushed, or engaging something well above their level, rolls to
// see it first. The roll span is appended by the narrator; these are the lead and the tail.
export const SCOUT_LEAD=[
  '{hero} checks the ground ahead...',
  '{hero} scouts ahead...',
  '{hero} stops, listens...',
  'Something moves near {hero}...',
];
export const SCOUT_PASS=[
  '{Mob} is spotted first. {hero} strikes before it closes.',
  '{hero} sees {mob} a breath before it sees back, and uses the breath.',
  '{Mob}, and {hero} already has a weapon up. First blood is the hero’s.',
];
export const SCOUT_FAIL=[
  '{Mob} is on {hero} before the first warning: {dmg} damage.',
  'Too late. {Mob} comes out of nowhere and takes {dmg} off {hero} before the fight begins.',
  '{hero} sees nothing, and {mob} proves it: {dmg} damage.',
];

// Flee roll: a hero breaking off at low health rolls to get clear.
export const FLEE_LEAD=[
  '{hero} breaks and runs from {mob}...',
  '{hero} turns from {the} and runs...',
  'Enough. {hero} runs from {the}...',
];
export const FLEE_PASS=[
  'and is gone before it can follow.',
  'and {the} loses the trail.',
  'and gets clear. Barely.',
];
export const FLEE_FAIL=[
  'and {the} gets one more bite in: {dmg} damage.',
  'but not fast enough: {dmg} damage on the way out.',
  'but {the} catches a heel going: {dmg} damage.',
];
export const FLEE_DEATH=[
  'and does not make it.',
  'and {the} finishes it on the road.',
];

// First elite sighting. Per-zone openers (keyed by zone name; GENERIC_ELITE is the fallback),
// each followed by one of ELITE_TAIL.
export const ELITE_OPEN={
  Thornvale:['Something large moves between the pines.','The birds in the wood go quiet all at once.','A shape too big for a wolf stands in the road.'],
  Mirefen:['The reeds part, and the water behind them does not settle.','Every lurker in the fen falls still at once.','Something old lifts its head out of the mud.'],
  Cinderpass:['A shadow crosses the crag road, and the crag road is in the sun.','Loose slag rattles down the slope. Nothing small moved it.','The ash stops drifting where something very large is breathing.'],
  Hoarfell:['The ice groans under a weight that is not snow.','A crown of frost rises out of the tarn.','The wights on the snowfield turn, all together, toward the deep ice.'],
};
export const GENERIC_ELITE=['Something large moves at the edge of sight.','The ordinary beasts of {zone} scatter from something that is not ordinary.'];
export const ELITE_TAIL=[
  '{elite} has found the road.',
  '{elite}, {title}, is hunting.',
  '{elite} is abroad in {zone}, and {hero} is the nearest thing to prey.',
];

// Boss pull: a raid engages. {n} raiders, {fac} the faction span.
export const BOSS_PULL=[
  'The lava ring stirs. {boss} raises its head and {n} heroes of {fac} stop pretending to be brave.',
  'Heat rolls off the lair. {boss} opens one eye, then the other, and {fac} commits.',
  '{n} heroes of {fac} step onto the cinder floor. {boss} has been waiting for this.',
];

// Dawn recap fragments. The narrator assembles 1-3 sentences from these.
export const DAWN_OPEN=['Dawn, day {day}.','Dawn breaks over '+WORDS.world+' on day {day}.','Day {day} begins.'];
export const DAWN_QUIET=[
  'Nobody died since the last dawn; the Chronicler checks the list twice.',
  'No graves were dug since the last dawn. It will not last.',
  'A day without a death. The gravediggers rest and the heroes do not.',
];
