# Eldmoor canon

Single source of truth for names and lore. Every agent reads this before naming
anything and adds new entries here. All names are original.

## Tone
Grounded classic fantasy with grit and dry humor. Every hero has one life; deaths
are remembered in the Graveyard and the Chronicle.

## Factions
- **The Concord** (blue). Capital: **Highgate**, northwest. Three human-like peoples (Hallowans, Tarrows, Skerrins; see Peoples); names like Alwyn, Pellora, Syleth.
- **The Warband** (red). Capital: **Grimhold**, southwest. Three peoples of brutes (Ashfolk, Mirekin, Thornhides; see Peoples); names like Thrakash, Zugnok, Grimrek.

## Peoples of Eldmoor
Every hero belongs to a people within their faction (`src/data/races.js`). A people has a
home town; recruits are born there, return there to sell and quest, and are buried in its
graveyard. Until the world spec grows the extra towns, every people of a faction shares the
capital (Highgate is Hallowan ground, Grimhold is Ashfolk ground). A hero's people shows on
the hero card ("People: Tarrow of Highgate") and in the recruit line ("A new Ashfolk
warrior, Kardul, joins <BF> Bloodfang in Grimhold."). Recruits are drawn to keep the living
roster of each faction roughly even across its peoples, with a nudge toward the classes a
people favours. Peoples differ in skin and hair, names, home and culture only; stats come
from class and level. Home towns not yet on the map are reserved names: Cairnmoot, Brinereach (today a hamlet), Murkstead and Thornteeth (today a camp).

| People | Faction | Home | Look | Favours | Culture |
| --- | --- | --- | --- | --- | --- |
| Hallowan (pl. Hallowans) | Concord | Highgate | Fair to tan skin; brown, wheat, red or black hair | Warrior, Priest | River-valley farmers, millers and ledger-keepers of the hedged lowlands around Highgate; swear by the harvest and bury their dead facing the water. |
| Tarrow (pl. Tarrows) | Concord | Cairnmoot | Ruddy, weathered skin; auburn, black or ash-blond hair | Hunter | Highland herders and hedge-wardens of the thorn ridges; taciturn, long-memoried, and the Concord's best bowmen. |
| Skerrin (pl. Skerrins) | Concord | Brinereach | Pale skin; black, dark red or salt-grey hair | Mage, Rogue | Fisherfolk and net-menders of the salt reaches; read weather in gull-flight, pay their debts to the tide and to each other, and favour the staff and the knife over the sword. |
| Ashfolk (pl. Ashfolk) | Warband | Grimhold | Grey-green to olive skin; black, soot-grey or rust hair | Warrior | Crag-dwellers of the ridges above Grimhold; raised in the fighting pits, measure worth in scars, and stand as the Warband's shield wall. |
| Mirekin (pl. Mirekin) | Warband | Murkstead | Bog-green and teal skin; black, dark green or bone-white hair | Priest, Rogue, Mage | Marsh-born trappers and salt-boilers of the fen margins; patient, poisonous, keep their dead in the water and their grudges longer. |
| Thornhide (pl. Thornhides) | Warband | Thornteeth | Ochre and umber skin; dark brown, umber or bone-grey hair | Hunter | Ridge-walkers and bone-carvers of the Thornteeth; trade skins for steel and will track a foe across three zones for the story of it. |

Names by people (prefix + suffix, never repeated within a world):
- Hallowan: Alwyn, Pellora, Syleth, Corric, Lysara, Garion.
- Tarrow: Branrhi, Gwilach, Maelwen, Dovon, Ulfagh, Kerrock.
- Skerrin: Haelir, Tevmund, Gullwen, Thessin, Marwy, Oskald.
- Ashfolk: Thrakash, Zugnok, Grimrek, Kardul, Vexosh, Ragmar.
- Mirekin: Ssathith, Bogaque, Zhalim, Yssoss, Velesh, Quagoth.
- Thornhide: Rhukur, Tuskak, Yurrug, Bralish, Kezeng, Hrakorn.

Sprites: the class gives the helm or hood colour and the weapon; the people gives the skin
and the hair that shows at the helm's rim and over the ears.

## Guilds
No guild is written down: the heroes found them (issue #56, `src/sim/guilds.js`). A fresh world has
none. Three or more unguilded heroes of one faction who keep company (a shared party, a bond of 6+,
or the same oath) within 20 tiles or in town raise a banner under their highest-level member:
"Pellora, Aliel and Gorn raise a banner: <FW> The Fenwatch." Others join through a party leader,
a sworn companion (bond 10+), or by signing the roll in town from level 3 (cap 12 a guild). The
leader is the highest-level living member (succession is logged). A guild of 6+ whose leader has
two or more blood-minded strangers among the members (rival or avenge-a-guildmate oaths) may
split; a guild with fewer than 2 living members for a game-week disbands and stays on record as
retired. Names and 2-3 letter tags are unique among living guilds and generated in faction voice
(`GUILD_VOICE` in `src/data/factions.js`):

- Concord (formal, civic): compounds of a stem and a tail, "The Fenwatch", "The Gatewardens"
  (stems Fen, Hearth, Reed, Lantern, Marsh, Ember, Tide, Oath, Stone, Dawn, Gate, Ford, Thorn,
  Bell, Heron; tails watch, wardens, keepers, wrights, bearers, guard, banner, wake), or an adjective
  and a noun, usually with "The": "The Hearth Accord" (Hearth, Amber, Silver, Quiet, Steadfast, Open,
  Hallowed, Gilded, Lantern, Evenfall, Green, Sworn; Accord, Covenant, Vigil, Compact, Circle,
  Assembly, Lantern, Fellowship, Charter, Oath).
- Warband (blunt, ugly): "The Bonegnash", "Gutter Pact", "The Bone Tide" (stems Gut, Bone, Rust,
  Scab, Ash, Grim, Slag, Sour; tails fang, gnash, maw, hide, rot, claw; adjectives Gutter, Bone, Rust,
  Black, Ash, Red, Grim, Sour, Iron, Broken, Cinder, Gore, Scab, Hollow; nouns Pact, Tide, Fang,
  Hounds, Knives, Maw, Cleavers, Brood, Mob, Pit, Fist, Wolves).
- Tags are the initials of the two parts, a third letter on a clash ("The Fenwatch" = FW).
- Retired canon: the four guilds the world first began with, **Silver Vow** (SV), **Dawnriders**
  (DR), **Bloodfang** (BF) and **Ashen Fist** (AF), are no longer seeded. They are old names that
  may reappear in the Chronicle as history or be worn again by a new banner.

## Classes
Warrior (armored melee), Mage (ranged burst), Hunter (ranged), Priest (healer), Rogue (melee, crits).

## Traits
Every hero is born with one or two of these and keeps them for life. Rogues lean
Reckless and Greedy, Priests Cautious, Loyal and Pious, Warriors Loyal and Reckless,
Mages Cautious and Boastful, Hunters Loner and Greedy. Nobody is both Reckless and
Cautious, or both Loyal and a Loner. About one recruit in three has their nature noted
in the Chronicle on arrival ("Thrakash is reckless and greedy; Grimhold will remember
that."), and the hero card lists them.

| Trait | Description | Effect |
| --- | --- | --- |
| Reckless | Fights on when wiser heads would run, and calls it courage. | Leaves the hunt at 32% HP instead of 45%, flees a fight or duel at 13% instead of 22%/20%, half again as likely to start a duel. |
| Cautious | Counts the exits before the enemies, and leaves while both are still open. | Heads home at 56% HP, flees fights at 31% and duels at 28%, 40% less likely to pick a duel. |
| Greedy | Never comes home while the bag has room, and buys gear only when the gold starts to itch. | Hunts until the bag holds 12 goods instead of 8; stops buying gear a little below the usual gear ceiling. |
| Loyal | Drops whatever they are doing when a guildmate shouts. | 60% more likely to rush to a guildmate's duel. |
| Loner | Leaves the gate alone and likes it that way. | Never forms or joins a party; slightly more likely to duel. |
| Vengeful | Keeps a list. Everyone on it is on it for good. | 20% more likely to duel and to answer a guildmate's call. |
| Pious | Tends the wounded before the wounds are grave, and does not stay to be martyred. | A Priest with it heals allies from 69% HP instead of 55%; flees a little earlier; 30% more likely to assist. |
| Boastful | Picks fights for the story, and loots for the audience. | 20% more likely to duel; hunts a little longer before selling. |

## Origins and goals
Every recruit arrives with a one-sentence backstory (`src/data/origins.js`, filled from the
living world by `src/sim/goals.js`) and swears an oath: a personal goal they pursue and the
Chronicle announces when kept ("Pellora has kept the oath: Hollowfang is dead. A new oath:
walk the snows of Hoarfell.") or mourns when they die short of it ("Thrakash died with the
oath unkept: Recover the Fenlight Lantern."). About one recruit in three announces origin
and oath together on arrival ("Pellora, a tanner's daughter from Hollowmere, swears to
recover the Fenlight Lantern."). Concord origins are formal and dry, Warband origins blunt.
The hero card shows origin, oath and progress.

**Hamlets.** Concord villages sit in the hedged farmland around Highgate: Hollowmere,
Wendell's Ford, Thistledown, Larkhollow, Brackenby, Oldwick, Brinereach, Fallow
Cross. Warband camps and holds are strung along the ridges and gullies south of Grimhold:
Skullrock, Red Gully, Gnashfang Hollow, Ironmaw, Bonepile, Scarhide Camp, Thornteeth,
Grukk's Ditch.

**Trades.** Concord: miller, tanner, scribe, drover, smith's apprentice, cooper, chandler,
ferryman, net-mender, hedge-warden. Warband: drover, tanner, bone-carver, pit-fighter,
smith's apprentice, skinner, trapper, whelp-minder, salt-boiler, gully-runner. The enemy's
raiders are "Warband raiders" to the Concord and "Concord riders" to the Warband.

**Origins** (seven per faction). A trade's son or daughter from a hamlet; one who lost a
brother, sister, mother or father to a named rare elite (and swears to kill it); one burned
out of their hamlet by the other faction's raiders (and swears to avenge a guildmate's
killer, or to out-level a rival); a hamlet's former scribe, ledger-keeper or bored tradesman;
the third of a family to serve (the first two did not come home); an heir to a lost epic the
family never stopped mentioning (and swears to recover it); a temple orphan, an outcast who
means to win enough fights to walk back in, a pit-killer hungry since twelve.

**Oaths.** A recruit's first oath is modest; each oath kept rolls a harder one (three
tiers), and an oath whose target dies first is void and re-sworn.

| Oath | Kept when | Changes behaviour |
| --- | --- | --- |
| Slay {elite} | the hero kills that named rare elite | - |
| Avenge {guildmate} by slaying {hero} | the hero kills, or is in the fight (within 8 tiles) that kills, the enemy who slew a guildmate; the lowest-level killers are chosen | the killer becomes a nemesis: charged on sight |
| Recover the {epic} | the hero loots that named zone epic | - |
| Bring the {epic} out of the Sunken Crypt | the hero loots that Crypt epic | first pick for Crypt groups |
| Tear the {epic} from Kragmaw | the hero loots that Kragmaw epic | first pick for raids |
| Walk the snows of Hoarfell | the hero sets foot in Hoarfell | once within 3 levels of the band, a solo hero's trips head for Hoarfell; the pilgrim turns home on arrival if under-levelled |
| Stand at the mouth of the Sunken Crypt | the hero reaches the Crypt mouth | same steering toward the Crypt; first pick for Crypt groups |
| Reach level N | level N | - |
| Out-level {hero} of the {faction} | the hero's level passes a named living enemy's | - |
| Slay Kragmaw the Cinder Wyrm | the hero is in the raid that kills Kragmaw | first pick for raids |
| Bank N gold | the hero holds N gold at once | - |
| Clear the Sunken Crypt | the hero's group clears the Crypt | first pick for Crypt groups |

## Abilities and skills

Every hero carries six ability scores and ten skills (`src/data/abilities.js`, `src/sim/abilities.js`). The names are plain working words, chosen so they never collide with the gear stats (Vigor, Might, Guard, Precision, Haste).

**Scores** (3-18 at recruitment: roll 4d6, drop the lowest, six times; the best go to the class's primary then secondary, the rest fall where they fall; modifier = floor((score - 10) / 2)):

| Score | Short | Means |
| --- | --- | --- |
| Brawn | BRN | Strength: blows, climbing, shouldering doors and men |
| Reflex | RFX | Quickness: aim, balance, the knife in the dark |
| Grit | GRT | Stamina and stubbornness: hit points, marches, cold |
| Wits | WIT | Learning and cunning: lore, locks, spellcraft |
| Insight | INS | Reading land and people: senses, tracks, wounds |
| Presence | PRS | Force of personality: bargaining, faith, the voice that carries |

Class priorities (primary / secondary): Warrior Brawn / Grit; Mage Wits / Insight; Hunter Reflex / Insight; Priest Insight / Presence; Rogue Reflex / Wits. The primary also feeds attack. Each people leans +1 toward one score: Hallowan Presence, Tarrow Insight, Skerrin Wits, Ashfolk Brawn, Mirekin Reflex, Thornhide Grit. At levels 5, 10, 15 and 20 a hero gains +1 to the primary and, half the time, +1 to the secondary (cap 20).

**Skills** (each keyed to a score): Tracking (Insight), Stealth (Reflex), Traps (Wits; locks, snares, needles), Persuasion (Presence), Intimidation (Brawn), Lore (Wits), Healing (Insight), Athletics (Brawn), Survival (Grit), Perception (Insight). A skill modifier is the score modifier plus the proficiency bonus (+2 at levels 1-4, +3 at 5-9, +4 at 10-14, +5 at 15+) if trained, or half of it (rounded down) if not, plus +1 from a fitting trait.

- Trained by class: Warrior athletics, intimidation, survival, perception; Mage lore, traps, persuasion; Hunter tracking, survival, stealth, perception; Priest healing, persuasion, lore, perception; Rogue stealth, traps, intimidation, persuasion.
- Trained by trade (only when the origin names one): miller and cooper athletics; tanner and skinner survival; scribe and bone-carver lore; drover and hedge-warden tracking; smith's apprentice, net-mender and trapper traps; chandler persuasion; ferryman perception; pit-fighter intimidation; whelp-minder and salt-boiler healing; gully-runner stealth.
- Trait nudges (+1): Cautious perception; Greedy traps; Reckless and Boastful intimidation; Vengeful tracking; Pious healing; Loyal persuasion; Loner stealth and survival.

**Where they are rolled.** Dungeon Master scenes: track/travel uses the better of tracking and survival, trap uses traps, lore uses lore, a rest's watch uses perception, social uses intimidation for the reckless, boastful and vengeful and persuasion for the pious, loyal, cautious and greedy (else whichever they do better). The party's best-suited member rolls, and the DM log names the skill, the member and the parts of the modifier. Fight scenes keep the combat roll. Road chests use traps, ambushes use perception, the narrator's scout uses the better of perception and stealth, and a flight uses athletics.

**Combat.** Grit adds to hit points per level, the primary score to attack, Reflex nudges crit. All are measured against the average hero so population stats stay put and only the spread between heroes changes: a Warrior with high Grit is the toughest thing in the Concord, a Mage with low Grit dies sooner.

## Bonds and blood debts
Heroes who fight side by side grow fond of each other (`src/sim/bonds.js`). Shared kills,
heals, rescues in a duel and setting out in a party raise a bond; a day apart wears it
down. Six points make friends, fifteen make sworn companions, and the Chronicle says so
when the line is crossed. When a hero falls to an enemy hero, the sworn companions take
the killer as a nemesis and friends do so half the time, so the grudge outlives the dead
and is hunted on sight ("spots X, who killed their friend Y, and charges"). The closest
friend swears the death will be paid for. Whoever finally kills the killer has paid the
blood debt, and the dead hero's friends warm to them. A grudge ends only with the killer.

## Zones
| Zone | Levels | Description |
| --- | --- | --- |
| Thornvale | 1-5 | Green woods and meadows between the capitals and the river. |
| Mirefen | 6-10 | Swamps and mud flats east of the river. Contested; most PvP happens here. |
| Cinderpass | 11-15 | Volcanic rock and peaks in the east. |
| Hoarfell | 16+ | Wind-scoured snowfields and frozen tarns north of the fen and the pass. |

The Stepping Lands, a larger test continent with six regions of its own (Lowmark, Sedgewater, Cairnwold, Cinderreach, Rimeholt, Palereach), are listed under Landmarks.

## Weather
Every zone has its own sky, and it turns every one to three hours. Thornvale gets drizzle and rain. Mirefen's fogs roll in off the fen and hide hunter and hunted alike. Cinderpass sees grey ashfall and, now and then, a choking ash storm. Hoarfell's snows thicken into squalls that close the high ground. Rain and snow slow travel, fog and storms shorten sight, and ash storms and squalls drive hunters back to town until they blow over.

## Road encounters
The roads between the gates are never quite empty. At most three encounters stand on
road tiles at a time, each at least twelve tiles from any gate; a new one appears every
one to two game hours and an ignored one is gone after a game day. Heroes walking out
or home notice one within four tiles and detour to it, unless they are below 40% HP,
walking through an ash storm or squall, or following a party leader (only the leader or
a solo hero detours). Every resolution is one Chronicle line with the roll shown.

| Encounter | What it is | Outcomes |
| --- | --- | --- |
| Wagon merchant | A tinker's covered wagon with a lantern on the bow, selling road-worn gear to anyone with coin. | d20: 11+ a bargain (3g per level), else full price (4g per level). One piece of road-worn gear at the hero's level, once per hero per wagon, never above the city shop's ceiling. |
| Lanternstone shrine | A wayside pillar of grey stone with a flame that nobody tends and nobody has seen go out. Travellers kneel for luck. | d20: blessed (the next blow lands 20% harder); 16+ the lantern burns bright and also mends 30% HP. |
| Strongbox | A banded chest left in the ditch, locked, and not left there by accident. | d20 vs 10 + 2 per zone: gold (5g per level) or a needle in the lock for 25% max HP. Gone either way. |
| Lost pilgrim | A hooded traveller with a pack and a staff, well off any road they meant to take, looking for a gate. Picked up by heroes on the way home. | Escort to the hero's own city for +3 honor; d20 12+ adds a gift (2g per level + 3). The pilgrim waits by the roadside again if the hero dies, leaves the road or dawdles for three game hours. |
| Rookscar ambush | Two or three Rookscar bandits step out of the verge: hooded cutpurses who work the roads of every zone and rob rather than kill. | d20 + half the hero's level (a party uses its best) vs 12 + 2 per zone: the bandits break and run for the XP of a zone-level kill and their purses, or the hero is cut for 35% max HP and driven home. Parties share the XP. An ambush wounds; it never kills. |

Sample lines:
- "Alwyn haggles with a wagon merchant on the Mirefen road... rolls 15. A bargain: new gear for 27g."
- "Miriel kneels at a lanternstone on the Thornvale road... rolls 18. The lantern burns bright: blessed and mended for 21."
- "Zugmar pries at a strongbox on the Mirefen road... rolls 20 vs 12. Gold: 35g."
- "Vexzar brings the pilgrim safe to the gate of Grimhold... rolls 20. +3 honor and a gift of 19g."
- "Pellora and party are ambushed by 2 Rookscar bandits on the Mirefen road... rolls 12+3 vs 14. The bandits break and run; 20g in their purses."

## Landmarks
- **The Sunken Crypt**: dungeon in southern Mirefen. Boss: **Lich-Warden Vesk**. Groups of 4-5.
- **Kragmaw's Lair**: lava ring in eastern Cinderpass. World boss **Kragmaw the Cinder Wyrm**, level 20, raided by 5-6 heroes of level 14+ (or four well-geared ones).

### The Stepping Lands (test continent, not the home map)
`STEPPING` in `src/world/spec.js` is a 160x100 stepping-stone map, four times the area of Eldmoor, used to test pacing, travel times and performance on the way to a larger world. Select it with `?world=stepping` in the browser or `ELDMOOR_WORLD=stepping` in Node; the default is Eldmoor. It keeps Highgate, Grimhold, the Sunken Crypt and Kragmaw, and adds two more home towns and four new regions. Its geography is a test layout, not canon for Eldmoor itself. The monsters of each region are first-pass copies of the Eldmoor species (`src/data/fauna.js`), waiting for a creature-designer pass.

| Region | Levels | Description |
| --- | --- | --- |
| Lowmark | 1-5 | Meadow and wood in the west, between the four home towns and the Greywater. Everyone starts here. |
| Sedgewater | 4-9 | Fen and mud flats east of the Greywater. The Sunken Crypt lies in its south. |
| Cairnwold | 8-13 | Dry upland of crags, scree and stunted trees north of the fen; the Hollow Cairn is cut into its hills. |
| Cinderreach | 12-16 | Slag, ash and lava in the east; Kragmaw's lair burns on its western edge. |
| Rimeholt | 15-19 | Snowfield and frozen scrub in the north-east, beyond the Cinderreach road. |
| Palereach | 18-22 | The far north-eastern tundra, the pale end of the map. Where the Stepping Lands' pilgrims hope to walk. |

| Town | Faction | People | Notes |
| --- | --- | --- | --- |
| Highgate | Concord | Hallowan | As in Eldmoor, in the north-west corner. |
| Cairnmoot | Concord | Tarrow | A cairn-ringed hill market on the western bank of the Greywater. Its name was reserved in "Peoples of Eldmoor". |
| Grimhold | Warband | Ashfolk | As in Eldmoor, in the south-west corner. |
| Murkstead | Warband | Mirekin | A stilted salt-boilers' town at the fen margin, west of the Greywater. Its name was reserved in "Peoples of Eldmoor". |

- **The Greywater**: the river that divides Lowmark from the fen and the upland.
- **The Hollow Cairn** (level 8-13, Cairnwold): placeholder second dungeon. Only the entrance exists today; it has no group runs, boss fight or loot. Its warden, **The Cairn-Warden**, is reserved for the future dungeon.
- **Brask Ironhorn, the Ram-King of the Cairnwold** (Cairnwold elite, level 15, kin Tundra Shaghorn): a crag-ram with one horn snapped and the other grown into his own shoulder. Placeholder.
- **Whitemaw, the Snow-Hound of Rimeholt** (Rimeholt elite, level 21, kin Rimehound): a pale, silent hound that hunts at the edge of sight. Placeholder.
- The other elites of the Stepping Lands are the Eldmoor four (Hollowfang in Lowmark, Old Mother Sedge in Sedgewater, Scoriath in Cinderreach, Ulfryn Coldmarrow in Palereach), re-levelled to their regions. Brinereach and Thornteeth stay reserved.

### Test fixtures (not canon)
`TESTWORLD` in `src/world/spec.js` is a 40x30 fixture for the world generator check and never appears in the game. Its names are reserved so they are not reused for real places: **Lowmead** (meadow, 1-5), **Greyreach** (fen, 6-10), the town **Wendmere**, the brook, and the dungeon **The Barrow Gate** with its boss **The Barrow Reeve**.

## Creatures
| Creature | Zone | Levels | Drops | Quest |
| --- | --- | --- | --- | --- |
| Timber Wolf | Thornvale | 1-3 | Wolf Pelt | Wolves at the Gate |
| Bristleback Boar | Thornvale | 2-5 | Boar Tusk | Tusks for the Tanner |
| Webspinner | Thornvale | 3-6 | Silk Bundle | Cut the Webs |
| Bogling | Mirefen | 6-9 | Fen Moss | Trouble in the Fen |
| Mudback Boar | Mirefen | 7-10 | Thick Hide | Hides for Winter |
| Fen Lurker | Mirefen | 8-11 | Venom Sac | Venom for the Apothecary |
| Cinder Golem | Cinderpass | 11-15 | Ember Core | Heart of the Mountain |
| Ash Drake | Cinderpass | 13-17 | Cinder Scale | Ash on the Wind |
| Rimehound | Hoarfell | 15-18 | Rime Pelt | Howls on the Snowfield |
| Tundra Shaghorn | Hoarfell | 16-19 | Hoar Wool | Wool for the Weavers |
| Tarn Wight | Hoarfell | 18-21 | Wight Marrow | What the Tarn Keeps |

Hoarfell bestiary notes: Rimehounds are lean slate-blue pack hunters that run the
snowfields in threes and fours and can be heard long before they are seen. The
Tundra Shaghorn is a hulking, horned, mat-furred grazer that ignores heroes until
prodded and then does not stop. Tarn Wights are the frozen dead of the tarns, gaunt
shrouded things trailing cold mist, that climb out of the ice at dusk; what they
leave behind is sold as marrow and nobody in Highgate asks what it is for.

Mob ecology: each zone has a natural population (the spawn counts) and a ceiling of
about one and a half times that. When no hero has hunted a zone for a couple of hours
its creatures breed toward the ceiling and drift from their dens toward the roads, so
travellers notice an unhunted zone before they enter it; they never cross a zone's
border. Hunters thin the herd back to its natural size. Spillover keeps clear of the
Thornvale roads nearest the city gates.

## Rare elites
Named beasts, one per zone and never two at once. They appear without warning (the
Chronicle says "Rumours spread of ... stalking ..."), roam the whole zone instead of a
den, ignore prey more than two levels beneath them and the already wounded, mend
slowly, and are far tougher than their kin (about twice the hide, half again the bite).
A slayer always carries off one of the zone's epics, and the Chronicle names both. Once
one falls, no new elite stalks that zone for at least ten hours.

| Elite | Zone | Level | Kin | Notes |
| --- | --- | --- | --- | --- |
| Hollowfang, the Old Wolf of Thornvale | Thornvale | 7 | Timber Wolf | Grey-muzzled and one-eared; has outlived three packs and most of the hunters sent after him. |
| Old Mother Sedge, Matriarch of the Fen | Mirefen | 12 | Fen Lurker | Her nests clog the reed beds; every lurker in the fen is one of hers. |
| Scoriath, the Drake of the High Pass | Cinderpass | 17 | Ash Drake | Scales black as cooled slag; roosts on the crags above the lair road. |
| Ulfryn Coldmarrow, the Tarn-King | Hoarfell | 22 | Tarn Wight | Crowned wight of the deepest tarn; the lesser wights climb out of the ice in his wake. |

## Epic items
- Thornvale: Fang of the Old Wood, Thornheart Longbow, Bramblecrown
- Mirefen: Mosswoven Cloak, Bogwalker Boots, Fenlight Lantern
- Cinderpass: Ember-Forged Greatsword, Cinderscale Mantle, Magma-Tempered Gauntlets
- Hoarfell: Rime-Etched Warpick, Shaghorn Greatcloak, Icevein Diadem
- Sunken Crypt: Vesk's Phylactery Shard, Drowned King's Signet, Cryptbound Greaves, Staff of Still Water
- Kragmaw: Kragmaw's Molten Eye, Wyrmbone Crown, Cinder Wyrm Fang, Mantle of the Ashen King

## Equipment
Every hero wears seven pieces: **head, chest, hands, feet, main hand, off hand** (a shield,
tome or ranged weapon) **and a trinket**. Each piece has a name, an item level and a zone of
origin. Ordinary pieces are named `<material> <slot noun>`: the material says where it came
from, the noun what kind of hero wears it. Town smiths and tailors sell pieces at the hero's own
level for 6 gold a level; monsters drop one now and then at their own level, give or take one,
and named elites always do. A hero wears an upgrade on the spot and sells what it replaced at
the auction house. Epics take a slot outright, are never displaced by ordinary gear, and grow with
their bearer: a smith reworks a worn epic to the hero's own level and a little more on every visit
home, so a relic looted at level three is still a relic at twenty.

Materials by zone: Thornvale **Bramble, Oakbark, Wolfhide**; Mirefen **Mossweave, Bogiron,
Fenleather**; Cinderpass **Cinder, Emberforged, Ashsteel**; Hoarfell **Rime, Hoarfrost,
Icevein**. Weapons, shields and bows take the hard materials only (Oakbark, Bogiron,
Emberforged, Ashsteel, Icevein).

| Class | Head | Chest | Hands | Feet | Main hand | Off hand | Trinket |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Warrior (plate) | Helm | Breastplate | Gauntlets | Greaves | Longsword | Shield | Medallion |
| Mage (cloth) | Cowl | Robe | Wraps | Sandals | Staff | Grimoire | Charm |
| Priest (cloth) | Circlet | Vestment | Mitts | Slippers | Mace | Censer | Reliquary |
| Hunter (leather) | Hood | Jerkin | Gloves | Treads | Hatchet | Longbow | Talisman |
| Rogue (leather) | Mask | Vest | Grips | Softboots | Dagger | Shiv | Lockcharm |

Examples: Wolfhide Jerkin, Oakbark Longsword, Mossweave Cowl, Bogiron Censer, Ashsteel
Shield, Emberforged Dagger, Hoarfrost Reliquary, Icevein Longbow.

Epics by slot: head Bramblecrown, Icevein Diadem, Wyrmbone Crown; chest Mosswoven Cloak,
Cinderscale Mantle, Shaghorn Greatcloak, Mantle of the Ashen King; hands Magma-Tempered
Gauntlets; feet Bogwalker Boots, Cryptbound Greaves; main hand Fang of the Old Wood,
Ember-Forged Greatsword, Rime-Etched Warpick, Cinder Wyrm Fang, Staff of Still Water; off hand
Thornheart Longbow, Fenlight Lantern; trinket Kragmaw's Molten Eye, Vesk's Phylactery Shard,
Drowned King's Signet.

### Item stats, qualities and affixes
Every piece carries stats. **Vigor** raises a hero's health, **Might** their strike, **Guard**
turns a share of every blow aside (at most 35 percent), **Precision** makes a blow more likely to
land true, and **Haste** shortens the pause between blows (at most 25 percent). Heads and chests
carry the most, trinkets the least. Weapons lean to Might and Haste, armour to Vigor and Guard,
trinkets to Precision and Haste; Warriors' gear leans to Vigor and Guard, Mages' and Priests' to
Might and Haste, Hunters' and Rogues' to Precision and Might.

Quality: **plain** (seven in ten drops), **fine** (about one in four: a tenth more stats and one
affix, shown in green) and **rare** (one in twenty: a third more stats and two affixes, shown in
blue). Town smiths sell plain and fine pieces; named elites drop fine or rare ones; epics are
purple. An affix is a suffix in the voice of the zone, and it pulls its own stat up.

| Zone | Affixes (leaning stat) |
| --- | --- |
| Thornvale | of the Briar (Guard), of the Hollow Oak (Vigor), of the Hare (Haste), of the Wolf Run (Might) |
| Mirefen | of the Mire (Vigor), of Still Water (Guard), of the Fen Light (Precision), of the Heron (Haste) |
| Cinderpass | of the Ember (Might), of the Forge (Guard), of the Cinderfall (Precision), of the Slagwind (Haste) |
| Hoarfell | of the Rime (Guard), of the Hoarwind (Haste), of the Long Night (Vigor), of the Drift (Precision) |

Epic stat blocks are fixed ratios of the item's level, so a relic grows with its bearer.
Stats at item level 20, with the line each epic carries:

| Epic | Stats at ilvl 20 | Flavour |
| --- | --- | --- |
| Fang of the Old Wood | 26 Might, 16 Haste, 14 Precision, 8 Vigor | Cut from a hollow oak's first limb; it hums when wolves are near. |
| Thornheart Longbow | 20 Precision, 16 Might, 12 Haste | The string is wound with bramble fibre and never goes slack. |
| Bramblecrown | 30 Vigor, 18 Guard, 10 Precision, 8 Haste | Thorns turned inward, which is how a brave head is told from a foolish one. |
| Mosswoven Cloak | 32 Vigor, 20 Guard, 14 Haste | Grown rather than sewn; the bog keeps its wearer warm. |
| Bogwalker Boots | 18 Vigor, 18 Haste, 12 Guard | The mud lets go of them a heartbeat early. |
| Fenlight Lantern | 18 Might, 16 Precision, 14 Vigor | A pale flame that shows where a foe is weakest. |
| Ember-Forged Greatsword | 32 Might, 16 Precision, 12 Haste, 8 Vigor | Quenched in Cinderpass ash; it is never quite cold. |
| Cinderscale Mantle | 28 Vigor, 26 Guard, 14 Might | Scales shed by something that did not need them any more. |
| Magma-Tempered Gauntlets | 18 Might, 16 Haste, 14 Guard | They glow when a grip is about to matter. |
| Rime-Etched Warpick | 30 Might, 16 Vigor, 12 Guard, 10 Precision | Frost patterns crawl up the haft with every swing. |
| Shaghorn Greatcloak | 34 Vigor, 24 Guard, 10 Haste | Hide of the shaghorn, heavy as a promise to stay alive. |
| Icevein Diadem | 20 Might, 18 Precision, 18 Vigor, 12 Haste | Cold enough to sharpen thought, and nothing else. |
| Kragmaw's Molten Eye | 20 Precision, 14 Might, 10 Haste | It still watches the lair it was torn from. |
| Wyrmbone Crown | 32 Vigor, 20 Guard, 14 Might, 8 Precision | A crown for someone who has already won. |
| Cinder Wyrm Fang | 36 Might, 18 Haste, 12 Precision, 8 Vigor | A tooth as long as a forearm, and twice as eager. |
| Mantle of the Ashen King | 36 Vigor, 28 Guard, 10 Might | Ash drifts from its hem and never reaches the floor. |
| Vesk's Phylactery Shard | 18 Might, 14 Haste, 12 Vigor | A sliver of a lich that wanted to be remembered. |
| Drowned King's Signet | 18 Precision, 14 Vigor, 12 Guard | Still wet, no matter how long it is worn. |
| Cryptbound Greaves | 22 Vigor, 16 Guard, 14 Haste | Made to stand a long vigil, and to leave it quickly. |
| Staff of Still Water | 28 Might, 20 Haste, 12 Vigor, 8 Guard | Not a ripple on it, even in the middle of a fight. |

An item remembers where it came from (`src`: "Dropped by Hollowfang", "Bought in Highgate",
"Road merchant", "Looted from ...") and the piece it replaced, so the Gear tab can show both.

## Trade goods
Wolf Pelt, Boar Tusk, Silk Bundle, Fen Moss, Thick Hide, Venom Sac, Ember Core, Cinder Scale, Rime Pelt, Hoar Wool, Wight Marrow, Grave Dust.

Base prices climb with zone: Thornvale 4-7, Mirefen 9-14, Grave Dust 18, Cinderpass 22-26, Hoarfell 30-40.

## Townsfolk
Every town has six named residents (`src/data/npcs.js` roles and lines, `src/sim/npcs.js`
routines). Each is one of the town's own people, named from that people's syllables when the
world starts (so the innkeeper of Highgate is a Hallowan and keeps her name all run long, but
no name is canon; a fresh world rolls fresh townsfolk). They never fight and never leave the
walls. By day they keep their posts; at night they sleep in a row of houses along the back
wall, opposite the gate. Heroes sell at the quartermaster's table and take their writs from
the gate captain, so those two posts are the old auction-house and quest-giver stops.

| Role (Concord / Warband) | Post | Hours | Does |
| --- | --- | --- | --- |
| Innkeeper / Mead-keeper | The inn by the south wall | 08:00-24:00 | Beds, stew, tabs, and a wager on who comes back. |
| Smith / Forge-master | The forge by the north wall | 06:00-21:00 | Mends edges and dents; cannot mend pride. |
| Quartermaster / Quartermaster | The table in the market | 06:00-21:00 | Buys pelts, fangs and oddments; runs the auction house. |
| Priest / Shaman | The chapel (Concord) or the spirit circle (Warband) in the gate-side corner | 06:00-21:00 | Lights a candle for every name that leaves the gate; blesses Crypt parties. |
| Bard / Boast-singer | The square, mid-path; strolls about it | 06:00-21:00 | Rhymes names, sings the news. |
| Gate Captain / Gate Warden | Just inside the gate | Always | Hands out writs, takes reports, never leaves the gate. |

Townsfolk speak through the same chat layer as heroes (bubble in follow view, a line in the
chat tab of every hero within 7 tiles): a greeting when a hero comes within two tiles of the
post, no more than once per 30 real seconds per resident and one roll per hero per game week,
plus a line on opening and closing. Concord townsfolk are formal and dry, Warband townsfolk
blunt and loud. Two of them watch the world:
- The **bard** sings of the latest named elite slain (naming the hero and the beast) and of
  Kragmaw's death, once per town per deed, a proud verse for the home faction and a sour one
  for the enemy's hero.
- The **priest or shaman** blesses a Sunken Crypt party of their faction forming in town
  (`blessed`: one strike at +20%, as the wayside lanternstones grant), hurrying to the gate
  while members are still inside the walls.

Samples:
- Highgate innkeeper: "Still alive, {target}. I had a wager on it. Thank you for that."
- Highgate priest, blessing: "Kneel a moment, {target}. There. Whatever waits below, you do not face it alone."
- Highgate bard, song: "Hear it, Highgate: {hero} has brought down {elite} in {zone}. I am adding a verse."
- Grimhold forge-master: "Hit harder, {target}, and I will have to make it thicker."
- Grimhold gate warden: "{target}. You went out. You came back. That is the whole of my report."
- Grimhold boast-singer, enemy kill: "The Concord's {hero} killed {elite} in {zone}. Fine. The next one is ours."

## Voices
Heroes speak short lines in context (`src/data/barks.js`; picked and cooled down by
`src/sim/chat.js`). Concord lines are formal and dry; Warband lines are blunt and
boastful. Every line is original to Eldmoor. A hero speaks at most once per 20 real
seconds (death, epic, duel and kill lines may cut in after 3); heroes within 7 tiles hear
it, and the line shows as a speech bubble over the sprite in follow view.

Triggers: **quest** (turn-in), **depart** (leaving the gate), **spot** (engaging a monster
two or more levels up, or a named elite), **flee**, **levelup** (every 5, or 15+), **epic**,
**duel**, **assist** (rushing to a guildmate), **mourn** (a guildmate or party member dies
in sight), **kill** (slaying an enemy hero), **party** (forming up), **idle** (in the city),
**banter** (a party afield for a minute). Some triggers add a class line or two.

Samples:
- Concord, quest: "Task concluded. The ledger balances."
- Concord, flee: "A tactical withdrawal. Entirely planned."
- Concord, mourn: "A candle for {target} tonight. Then work."
- Warband, depart: "Out the gate. Blood before breakfast."
- Warband, duel: "{target}! Your head or mine. Mine stays."
- Warband, epic: "Hah! {item}. Try and take it."

## The Chronicler
The Chronicle has a second voice beside the plain record of kills and quests: the
Chronicler, who sets scenes, calls the dice and sums up each day at dawn. Templates
live in `src/data/narration.js`; triggers, the dice and the recap in `src/sim/narrator.js`.
The voice is third person, present tense, grounded and dry. It never addresses the
watcher, never speaks of respawns or of the world as a game, and quotes nothing from
anywhere else. Its lines show in italics with a gold rule in the Chronicle (class `nar`).
Scene lines keep to one per 20 real seconds; a roll that leaves a hero under half health,
a roll that kills, and the dawn recap may cut in regardless.

Dice are real d20 rolls on the game's dice, shown dim in the line ("rolls 14+2 vs 12"),
and they change what happens:

| Check | When | Roll | Pass | Fail |
| --- | --- | --- | --- | --- |
| Scout | A monster ambushes a hero, or a hero takes on one two or more levels up (once per engagement). | d20 + level/3 (+2 for Hunters and Rogues) vs 10 + 2 per zone (+3 when fog, ash or snow cut sight). | The hero lands a strike before the fight proper and the monster's first bite is delayed. | The monster lands one free hit. It wounds; it never kills by itself. |
| Flee | A hero breaks off a monster fight at low health. | d20 + level/4 vs 11. | Clean away. | One glancing bite lands on the way out. At flee health that can kill, and a death here is always narrated. |

Triggers and samples:
- **Zone entry** after dark (19:00-05:00) or under weather, by a solo hero or a party leader, two times in five:
  "Night falls on Mirefen as fog closes in; Alwyn's party presses on." /
  "Rain hammers down over Thornvale. Feneth's party pulls a hood up and goes in."
- **Scout check** (about one roll in seven is narrated; a dozen happen every minute): "Pellora scouts ahead... rolls 14+2 vs 12. A Fen Lurker is spotted first. Pellora strikes before it closes." /
  "Coreth stops, listens... rolls 2+2 vs 10. Coreth sees nothing, and a Webspinner proves it: 13 damage."
- **Flee roll** (two in five are narrated; every fatal one is): "Enough. Valanne runs from the Bristleback Boar... rolls 13 vs 11, and gets clear. Barely." /
  "Lysora turns from the Fen Lurker and runs... rolls 3+2 vs 11, but not fast enough: 7 damage on the way out."
- **Elite sighted**, the first time a hero comes within six tiles of a living named elite, with a per-zone opener:
  "Something large moves between the pines. Hollowfang has found the road." /
  "The reeds part, and the water behind them does not settle. Old Mother Sedge, Matriarch of the Fen, is hunting."
- **Boss pull**, when a raid first engages: "The lava ring stirs. Kragmaw raises its head and five heroes of the Warband stop pretending to be brave."
- **Dawn recap** at 06:00 every game day, one to three sentences on the day since the last dawn (deaths and their causes, levels gained and the highest hero, elites slain, Crypt clears and wipes, Kragmaw's state):
  "Dawn, day 8. Twelve fell since the last dawn: three to monsters and nine to enemy heroes. 23 levels gained; Feneth stands highest at 9. The Crypt was cleared once; Kragmaw sleeps untouched." /
  "Day 15 begins. Nobody died since the last dawn; the Chronicler checks the list twice. 31 levels gained; Ragrek stands highest at 13, and Old Mother Sedge is dead. The Crypt was cleared once; Kragmaw sleeps untouched."

## Adventures
Heroes do not only hunt for the gate captain's tally. The towns post jobs, and a party (or a
lone hero) takes one up and sees it through over a day or more: an adventure. A Dungeon Master
runs them, rule-of-thumb for now (`src/sim/dm.js`, templates in `src/data/adventures.js`).
Every adventure is a hook, three to five scenes on real places of the map, and an ending;
the dice decide each scene, and what goes wrong carries forward. The kill-count writs are
still there for heroes below level 4 and for anyone with nothing better on offer.

**Where jobs come from.** Each town keeps up to three jobs posted, each for a day or two, plus
personal ones for a single hero:
- the **gate captain**'s writs and the **smith**, **priest**, **quartermaster**, **bard** and
  **innkeeper**'s requests, given by name ("Gate Captain Merel stops Alwyn's party at the
  Highgate gate with a job");
- **rumours** at the inn of a named elite on the prowl (a hunt for the real beast, for parties
  that can stand against it);
- **graves**: a hero of the town who fell in the last day left a pack where they died;
- **remnants** of the road: a robbed traveller, a strongbox sprung in a ditch, a wagon
  merchant who never came back;
- **oaths**: a hero sworn to kill an elite is offered its hunt, an heirloom-seeker a relic,
  a pilgrim a message to carry to the Crypt mouth or the far country, a hoarder a paying escort;
- **follow-ups**: a job well done sometimes brings the next one to the same hero.

**Kinds of adventure** (titles are patterns; the subject comes from the hook):

| Adventure | Party | From level | Scenes |
| --- | --- | --- | --- |
| Rescue ("Bring Home a woodcutter") | 1-3 | 4 | search the region, break the monsters' ring, a choice (straight through the brush past an old snare-line, or a night's camp on the road), bring them to the gate |
| Escort ("Escort a salt wagon to Cairnmoot") | 1-3 | 4 | out of the gate, a snare across the road, monsters drawn by the wagon, deliver and be paid |
| Investigate ("What Happened on the Mirefen Road") | 1-3 | 4 | read the ground where it happened, question a stranger, a choice (follow the claw-marks to a named beast, or report what is known) |
| Clear a lair ("Clear the Den in Thornvale") | 2-3 | 5 | track the pack, the snared den mouth, the pack, the pack's master |
| Recover a relic ("Recover the chapel's lantern-bell") | 1-3 | 4 | search beside a landmark, the hiding place's trap, a choice (take it back from a scavenger's camp, or buy it back), carry it home |
| Negotiate ("Parley with a Rookscar toll-crew") | 1-3 | 6 | meet them on the road, the parley, a choice (clear their road of beasts, or swear on the old road-law), bring the terms home |
| Hunt a named beast ("Hunt Crookback") | 2-3 | 5 | pick up the trail, a cold camp with a watch, the beast |
| Deliver a message ("Carry a sealed letter to the Mirefen waymark") | 1-2 | 4 | a hard pace on the road, a toll-gate that was not there last week, hand it over |
| Recover the fallen ("What Pellora Left Behind") | 1-3 | 4 | find where they fell, drive off the scavengers, bury them and keep watch, carry the gear home |

Deliveries go to another town of the hero's own faction where there is one, else to a
waymark on the region's road; a pilgrim's go to the Crypt mouth or the edge of the far country.

**Named foes.** Some adventures end in a fight with a beast that has a name for the length of
the job: Old Scar, the Grey Widow, Crookback, Longtooth, the Quiet One, Ashjaw, Rimeclaw,
Mudmother, Halfhorn, the Pale Hunger, Blackgums, Old Rot, each with a title such as "terror of
the Mirefen drovers" or "the oldest fen lurker in Mirefen". They are a monster of the region,
a level above the strongest of the party and tougher than their kind. They are not the rare
elites (Hollowfang and the rest), carry no epic and never come back; only an inn rumour or an
oath sends a party after a real elite.

**Scenes and dice.** A scene rolls d20 plus the party's best modifier (level/3, and a class
bonus for the kind of roll: Hunters track, Rogues find traps, Priests and Mages talk and know
old things, Warriors and Hunters strike first and keep watch) against 10 + a quarter of the
region's lowest level, plus the scene's own difficulty. Kinds of scene: **travel** (a march to a
point, sometimes a tracking roll), **fight** (real monsters spawned for the job; the roll decides
who strikes first), **social** (a parley, a haggle, a stranger questioned), **trap**, **choice**
(two roads, chosen by the leader's temper and the party's wounds) and **rest** (a camp with a
watch roll at the end). Consequences carry forward: wounds for everyone, half a day lost, a
stranger who will make the next parley harder and the next fight bigger, monsters out of the
dark at a failed watch. A natural 20 brings a find or an easier next step. A party worn below
three-fifths of its strength between scenes makes camp where it stands; a badly hurt one goes
home, and takes the job up again on its next trip out. Jobs left three days go cold.

**Endings.** The last roll decides between **success** and **partial**; a string of failed rolls
and lost days drags a success to partial and a partial to **failure**, and the leader's death
ends it. Success pays every member gold, experience and a little honor, a reward item for the
leader (and sometimes the others), and draws the party closer; partial pays half; failure
nothing. An heirloom hunt may turn up the heirloom itself. The first adventure of each kind seen
through by each faction, and every hunted elite brought down, go on the Timeline.

**In the Chronicle.** The Chronicler follows up to two adventures at a time beat by beat (and
always the one the watcher follows): the job's posting, one line per scene with the roll shown,
and the ending with the pay. The rest keep to the heroes' own logs, except the end of an
elite hunt and a death on the job.

Samples:
- "Gate Captain Valric stops Mireth's party at the Highgate gate with a job: Smoke Out the Mirefen Den."
- "Rhukorn's party tracks the pack to its den... rolls 2+4 vs 11. They find it the long way, by the smell. They lose the afternoon to it."
- "Halfhorn, terror of the Mirefen drovers, comes out last... rolls 18+3 vs 11. Mireth is ready for it."
- "Lurken delivers a salt wagon at the Thornvale waymark... rolls 7+2 vs 10. Two crates short. The tallyman docks the pay and does not apologise."
- "Mireth's party returns from Smoke Out the Mirefen Den with the job done. 40g each, and Mireth takes Fenleather Vestment."

## Minds

Some heroes are played by a language model instead of the old rules of thumb. In Eldmoor that means nothing at all: there is no such thing as an AI-played hero, only heroes. They are born, swear oaths, hold grudges and die the same way as everyone else, once, for good. The UI marks them with an "AI-played" badge because the watcher may want to know; the world does not. A mind that falls silent (the relay is down) is written as a dim chronicle line, "<hero>'s thoughts go quiet", and the hero simply goes on as before. Minds speak in their faction's voice: Concord formal and dry, Warband blunt and short. They never mention models, prompts, players or games.

A hero played by an agent (one that chooses where to go and when, and keeps its own journal) is still just a hero in the world. It walks the same roads, rolls the same dice, sees only what its eyes reach and dies once like everyone else. The town does not know it is any different; only the watcher's "Agent" badge does. Its journal is the hero's own, written in the hero's voice.
