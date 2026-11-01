// Origins and goal templates: data only. Owned by character-builder.
// Every hero gets one origin sentence (a.origin) and a personal goal (a.goal); the
// generation and the progress logic live in sim/goals.js. All names are original and
// recorded in docs/LORE.md under "Origins and goals".
//
// Origin templates use these placeholders, filled from the living world:
//   {name} the hero   {hamlet} a home village of their faction   {trade} a trade
//   {child} son/daughter   {kin} brother/sister/mother/father   {elite} a named rare elite
//   {other} an enemy faction's raiders   {epic} an heirloom epic   {city} the home capital
// `loss` says what the backstory took from them, and biases the first goal:
//   'elite' -> avenge that elite   'raiders' -> avenge a guildmate's killer, or out-level a rival
//   'heirloom' -> recover the named epic   null -> any first goal

// Home hamlets per faction (index = faction). Concord villages sit in the hedged farmland
// around Highgate; Warband camps and holds are strung along the ridges and gullies south of
// Grimhold.
export const HAMLETS=[
  ['Hollowmere','Wendell’s Ford','Thistledown','Larkhollow','Brackenby','Oldwick','Saltmarsh Reach','Fallow Cross'],
  ['Skullrock','Red Gully','Gnashfang Hollow','Ironmaw','Bonepile','Scarhide Camp','Thornteeth','Grukk’s Ditch'],
];

// Trades a recruit (or their parent) worked before taking up arms.
export const TRADES=[
  ['miller','tanner','scribe','drover','smith’s apprentice','cooper','chandler','ferryman','net-mender','hedge-warden'],
  ['drover','tanner','bone-carver','pit-fighter','smith’s apprentice','skinner','trapper','whelp-minder','salt-boiler','gully-runner'],
];

// Raiders as the other factions name them, indexed by the RAIDERS' own faction: a Concord
// origin picks from every entry but RAIDERS[0].
export const RAIDERS=['Concord riders','Warband raiders'];

// The far zone pilgrims swear to reach (the highest-level zone, by name so a reordered
// zone table does not move the pilgrimage).
export const PILGRIM_ZONE='Hoarfell';

export const KIN=['brother','sister','mother','father'];
export const CHILD=['son','daughter'];

// Origin templates per faction. `text` is the full sentence for the hero card; `short` is
// the noun phrase used in the recruit line ("Pellora, a tanner's daughter from Hollowmere,
// swears to ..."). Concord formal and dry; Warband blunt.
export const ORIGINS=[
  [ // Concord
    {text:'{name}, a {trade}’s {child} from {hamlet}, took up arms the spring {elite} was seen on the mill road.',short:'a {trade}’s {child} from {hamlet}',loss:null},
    {text:'{name} lost a {kin} to {elite} and left {hamlet} with a borrowed blade and no intention of returning it.',short:'who lost a {kin} to {elite}',loss:'elite'},
    {text:'{name} was burned out of {hamlet} by {other} and has not forgotten a single face.',short:'burned out of {hamlet} by {other}',loss:'raiders'},
    {text:'{name} kept the {hamlet} ledgers as a {trade} until the day the ledgers stopped mattering.',short:'once the {trade} of {hamlet}',loss:null},
    {text:'{name} is the third of {hamlet}’s {trade} family to answer the Concord’s call. The first two did not come home.',short:'the third of {hamlet}’s {trade} family to serve',loss:null},
    {text:'{name} came down from {hamlet} to find the {epic} that a great-grandparent lost and the family never stopped mentioning.',short:'of {hamlet}, heir to a lost {epic}',loss:'heirloom'},
    {text:'{name} was raised in the {city} temple as a {trade}’s orphan and left the day the prayers ran out.',short:'a {trade}’s orphan from the {city} temple',loss:null},
  ],
  [ // Warband
    {text:'{name} was whelped in {hamlet}, a {trade}’s {child}, and fought for scraps before learning to walk.',short:'a {trade}’s {child} out of {hamlet}',loss:null},
    {text:'{name} watched {elite} drag a {kin} off into the dark. {name} has been looking ever since.',short:'who lost a {kin} to {elite}',loss:'elite'},
    {text:'{name}’s camp at {hamlet} was put to the torch by {other}. Only {name} walked out of the ash.',short:'sole survivor of {hamlet}',loss:'raiders'},
    {text:'{name} was a {trade} in {hamlet} until the work got dull and the fighting did not.',short:'a bored {trade} from {hamlet}',loss:null},
    {text:'{name} was cast out of {hamlet} for losing a fight, and means to win enough of them to walk back in.',short:'cast out of {hamlet}',loss:null},
    {text:'{name} swore on a {kin}’s bones to carry the {epic} home to {hamlet}.',short:'of {hamlet}, sworn to the {epic}',loss:'heirloom'},
    {text:'{name} killed the {hamlet} pit champion at twelve and has been hungry since.',short:'the pit-killer of {hamlet}',loss:null},
  ],
];

// Goal text templates per type. Filled by sim/goals.js; `text` starts with a verb so
// "swears to " + lower-cased text reads as an oath. Placeholders: {target} the named elite,
// epic or hero, {victim} the guildmate being avenged, {fac} the rival's faction, {need} the
// level or gold to reach, {zone} the pilgrimage zone.
export const GOAL_TEXT={
  avenge:'Slay {target}',
  avengeHero:'Avenge {victim} by slaying {target}',
  heirloom:'Recover the {target}',
  heirloomCrypt:'Bring the {target} out of the Sunken Crypt',
  heirloomBoss:'Tear the {target} from Kragmaw',
  pilgrimFar:'Walk the snows of {zone}',
  pilgrimCrypt:'Stand at the mouth of the Sunken Crypt',
  ascend:'Reach level {need}',
  rival:'Out-level {target} of the {fac}',
  legend:'Slay Kragmaw the Cinder Wyrm',
  hoard:'Bank {need} gold',
  delve:'Clear the Sunken Crypt',
};

// Chronicle lines on completion per type (the coloured hero name comes first).
export const GOAL_DONE={
  avenge:' has kept the oath: {target} is dead.',
  avengeHero:'’s oath is kept: {target} lies dead and {victim} is avenged.',
  heirloom:' holds the {target} at last. The oath is kept.',
  heirloomCrypt:' carries the {target} out of the Sunken Crypt. The oath is kept.',
  heirloomBoss:' tore the {target} from Kragmaw. The oath is kept.',
  pilgrimFar:' stands in the snows of {zone}, as sworn.',
  pilgrimCrypt:' stands at the mouth of the Sunken Crypt, as sworn.',
  ascend:' reached level {need}, as sworn.',
  rival:' has out-levelled {target}. The oath is kept.',
  legend:' saw Kragmaw fall. The oath is kept, and a legend begins.',
  hoard:' has banked {need} gold, as sworn.',
  delve:' walked out of the Sunken Crypt victorious, as sworn.',
};
