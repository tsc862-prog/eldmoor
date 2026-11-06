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
from class and level. Home towns not yet on the Eldmoor map are reserved names: Cairnmoot, Brinereach (today a hamlet), Murkstead and Thornteeth (today a camp). Brinereach and Thornteeth are real towns on the Stepping Lands test continent (see The Stepping Lands).

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

**Rivalries** (issue #6, `src/sim/rivals.js`): two guilds of opposing factions that keep spilling each
other's blood (a veteran of level 12+ cut down counts most) or contest the same prize (clearing the
Sunken Crypt, or slaying Kragmaw, within a day of each other) declare a rivalry. The Chronicle and the
timeline carry the declaration ("<FW> The Fenwatch and <BG> The Bonegnash declare a rivalry: ...")
and its end, when the blood cools or a banner falls; the guild panel lists each guild's rivals. Rival
members meeting in the wilds duel more readily, and guildmates rush in against a rival sooner. The
Fellowship's guild (the default company's) stays out of it.

**Guild focus** (issue #6, `src/sim/guildfocus.js`): a guild's leader turns its banner to one end,
chosen from who rides under it, their oaths and the guild's record, and weighed again each day or when
the banner passes. The four foci:

- **Delve**: the Sunken Crypt. Called up for Crypt groups far more often than other guilds.
- **Wyrmhunt**: Kragmaw (or whichever wyrm holds the lair). Its members muster first, and three of them
  will raid with a short party that others would think too poorly geared.
- **Wayfaring**: the town boards. Its leaders almost always take a fitting job at the gate.
- **Warpath**: enemy blood. Chosen only by a leader sworn to a blood oath or a guild with a declared
  rival; its members duel more readily and guildmates rush in sooner.

The Chronicle and the timeline (GUILD badge) carry each change ("<SC> The Sablecrest turns its banner to
the Delve: Mirric will lead them down into The Sunken Crypt."); the guild panel shows the focus. A guild
with no focus yet has none listed. The Fellowship's guild never takes a focus.

## Classes
Warrior (armored melee), Mage (ranged burst), Hunter (ranged), Priest (healer), Rogue (melee, crits), Skald (war-singer, see below), Wildspeaker (green-handed healer, see below).

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
A hero who plays by its own mind is given the past and chooses the oath (#800): the origin stays, and the rolled goal is only an
offered thread, told as the past ("Brunok's family once held the Magma-Tempered Gauntlets. It was lost, and they never stopped
speaking of it."). Nobody calls it an oath until the hero swears, aloud, in its own words. What follows is the background heroes' way.

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

Every hero carries six ability scores and ten skills (`src/data/abilities.js`, `src/sim/abilities.js`). The six scores are the only attributes in Eldmoor: items do not carry stats of their own, they add to scores (see Equipment).

**Growth** (levels 5, 10, 15, 20, cap 20): a scripted hero gains +1 to its class's primary score and half the time +1 to the secondary. A hero played by an agent chooses where its one point goes (`raise_score`, with a reason that enters its story); if it says nothing within a game day, or its runner is gone, the class default is taken for it.

**Scores** (3-18 at recruitment: roll 4d6, drop the lowest, six times; the best go to the class's primary then secondary, the rest fall where they fall; modifier = floor((score - 10) / 2)):

| Score | Short | Means |
| --- | --- | --- |
| Brawn | BRN | Strength: blows, climbing, shouldering doors and men |
| Reflex | RFX | Quickness: aim, balance, the knife in the dark |
| Grit | GRT | Stamina and stubbornness: hit points, marches, cold |
| Wits | WIT | Learning and cunning: lore, locks, spellcraft |
| Insight | INS | Reading land and people: senses, tracks, wounds |
| Presence | PRS | Force of personality: bargaining, faith, the voice that carries |

Class priorities (primary / secondary): Warrior Brawn / Grit; Mage Wits / Insight; Hunter Reflex / Insight; Priest Insight / Presence; Rogue Reflex / Wits; Skald Presence / Wits; Wildspeaker Insight / Grit. The primary also feeds attack. Each people leans +1 toward one score: Hallowan Presence, Tarrow Insight, Skerrin Wits, Ashfolk Brawn, Mirekin Reflex, Thornhide Grit. At levels 5, 10, 15 and 20 a hero gains +1 to the primary and, half the time, +1 to the secondary (cap 20).

**Skills** (each keyed to a score): Tracking (Insight), Stealth (Reflex), Traps (Wits; locks, snares, needles), Persuasion (Presence), Intimidation (Brawn), Lore (Wits), Healing (Insight), Athletics (Brawn), Survival (Grit), Perception (Insight). A skill modifier is the score modifier plus the proficiency bonus (+2 at levels 1-4, +3 at 5-9, +4 at 10-14, +5 at 15+) if trained, or half of it (rounded down) if not, plus +1 from a fitting trait.

- Trained by class: Warrior athletics, intimidation, survival, perception; Mage lore, traps, persuasion; Hunter tracking, survival, stealth, perception; Priest healing, persuasion, lore, perception; Rogue stealth, traps, intimidation, persuasion.
- Trained by trade (only when the origin names one): miller and cooper athletics; tanner and skinner survival; scribe and bone-carver lore; drover and hedge-warden tracking; smith's apprentice, net-mender and trapper traps; chandler persuasion; ferryman perception; pit-fighter intimidation; whelp-minder and salt-boiler healing; gully-runner stealth.
- Trait nudges (+1): Cautious perception; Greedy traps; Reckless and Boastful intimidation; Vengeful tracking; Pious healing; Loyal persuasion; Loner stealth and survival.

**Where they are rolled.** Dungeon Master scenes: track/travel uses the better of tracking and survival, trap uses traps, lore uses lore, a rest's watch uses perception, social uses intimidation for the reckless, boastful and vengeful and persuasion for the pious, loyal, cautious and greedy (else whichever they do better). The party's best-suited member rolls, and the DM log names the skill, the member and the parts of the modifier. Fight scenes keep the combat roll. Road chests use traps, ambushes use perception, the narrator's scout uses the better of perception and stealth, and a flight uses athletics.

**Combat.** Every hero has five combat totals, each one true figure with a breakdown (`src/sim/stats.js`, shown on the Stats tab):

- **Health**: class base, a share per level, Grit modifier x level, +10 for every epic ever looted, and +5% per *vital* item.
- **Attack**: class base, a share per level, the class's primary score modifier (weighted more as the hero levels), weapon damage, +3 per epic looted.
- **Defense**: the share of every blow turned aside. A Warrior's training turns aside a fifth; item armor and *warding* add to it; no one turns aside more than half.
- **Crit**: class base (Rogues 25%, everyone else 8%), a veteran's seasoning past level 11 (about +5% by level 20), Reflex, and +3% per *keen* item. A critical blow strikes for 1.8x.
- **Speed**: blows per second (a swing every 1.1 s), +8% per *swift* item.

Scores worn on items count everywhere a score does: a +2 Grit cloak adds hit points and also helps Survival rolls.

## Class abilities (issue #81)
Every class has three active abilities and two passives, learned by level (`src/data/moves.js`). The file is called *moves* so it never clashes with the six ability *scores*; players and agents only ever see "abilities". All names are original coinages from plain English words, not borrowed from any game.

Active abilities each have a cooldown in seconds and a matching cooldown in rounds (for the coming Table combat). An attack ability takes the place of a weapon blow; the rest are free.

| Class | Ability (level) | Kind | What it does |
| --- | --- | --- | --- |
| Warrior | **Challenge** (1) | control | Bellows a monster off a hurt friend and onto the Warrior. |
| Warrior | **Bastion** (4) | defend | Shield planted: blows land at 60% for six seconds. |
| Warrior | **Reckless Blow** (7) | attack | 190% damage for 5% of the Warrior's own health. |
| Mage | **Rune Lance** (1) | attack | 200% damage. |
| Mage | **Rime Ring** (3) | control | Frost around the Mage: 60% damage and a lost 2.5 s to every foe nearby (half on a save). |
| Mage | **Flicker Step** (6) | move | Steps three and a half tiles out of the fight; the foe loses 1.5 s. |
| Hunter | **Dead-Eye Shot** (1) | attack | 180% damage, +30% crit chance. |
| Hunter | **Gorse Snare** (3) | control | A thorn-cord noose: 40% damage, the foe loses 3.5 s (half on a save). |
| Hunter | **Quarry Mark** (6) | control | For eight seconds every blow on the quarry does 25% more. |
| Priest | **Ward of Dawn** (2) | defend | Blows on a friend land at 70% for eight seconds. |
| Priest | **Searing Word** (4) | attack | 170% damage; the foe flinches 0.8 s. |
| Priest | **Chorus of Mending** (6) | heal | Heals every friend within five tiles. |
| Rogue | **Ambush** (1) | attack | 280% damage, only on a fresh, unhurt foe. |
| Rogue | **Sinew Cut** (3) | attack | Normal damage; the foe loses 2.5 s (half on a save). |
| Rogue | **Smoke Veil** (5) | defend | Foes on the Rogue lose 2.5 s; blows land at half for four seconds. |

Passives: Warrior **Unbowed** (4, under 35% health blows land at 80%) and **Stout Heart** (8, +6% Health); Mage **Rune Memory** (3, +6% Crit) and **Opening Rune** (6, +30% on the first blow at an unhurt foe); Hunter **Hawk-Eyed** (2, +5% Crit) and **Trail-Wise** (7, +4% Defense); Priest **Gentle Hands** (1, healing +15%) and **Sanctuary** (8, under half health blows land at 90%); Rogue **Knife-Hand** (3, +6% Crit) and **Slip the Blow** (6, blows land at 95%).

The Skald's three abilities and two passives (Biting Verse, Rallying Verse, Dirge of Doubt; Practised Ear, Last Verse) are listed under "Skald", the Wildspeaker's (Briar Lash, Greenmend, Rootbind; Barkskin, Green Patience) under "Wildspeaker", and every level-10 path move and passive under "Specialisations"; this table keeps the first five classes. Flavor by move, for the chronicle: Challenge is a bellow across the field; Bastion, the shield planted like a gatepost; Reckless Blow, a swing that costs the swinger; Rune Lance, a rune thrown like a spear; Rime Ring, frost on the grass in a circle; Flicker Step, a seam in the air; Dead-Eye Shot, one held breath; Gorse Snare, thorn-cord underfoot; Quarry Mark, a name spoken over the prey; Ward of Dawn, warm light on a friend; Searing Word, a word the dark cannot stand; Chorus of Mending, a hymn that knits; Ambush, the first blow from the dark; Sinew Cut, a cut at the tendon; Smoke Veil, a pinch of powder and the room is smoke.

Saves: a control ability that can be resisted lets the foe roll d20 plus its modifier (a monster's is a quarter of its level, elites +2, Kragmaw +4) against 8 + the caster's stat modifier + training. Scripted heroes use abilities by simple class rules (a Warrior taunts a monster that is mauling a hurt friend; a Priest wards the friend in danger and sings the Chorus when two or more are hurt; a Rogue opens with Ambush; heroes keep attack abilities out of duels with each other). Agent-played heroes choose with the `use_ability` tool.

### Table conditions and parley (issue #296)
In Table combat rounds four plain conditions can hold on a hero or a foe, each shown as a badge on the banner and checked as a dice line (`src/data/moves.js` `CONDITIONS`):

| Condition | Laid by | What it does |
| --- | --- | --- |
| **Stunned** | Winter's Hold, Dirty Trick; a creature's fear or knockback (Bellow, Howl, Grave Dread, Gore, Slag Slam) | Loses its next turn unless a Grit save shakes it off on that turn. |
| **Rooted** | Rime Ring, Gorse Snare, Sinew Cut, Rootbind, Thornfield, Ring of Thorns; a web or a mire (Web Snare, Mire Grip, Rime Bite) | Cannot fall back or run, and its blows come 2 worse; a Reflex save each round breaks free. |
| **Poisoned** | Venom, Marrow Chill | A little damage at the end of each round; a Grit save then purges it. |
| **Warded** | Ward of Dawn, Bastion, Shield Cover, Rallying Verse, Antler Ward, Smoke Veil | Blows land lighter; it runs down with the rounds. |

A creature's slow (Mire Grip, Rime Bite) counts as Rooted at the Table. All of them end when the scene ends.

How long each holds when laid (`CONDITIONS` in `src/data/moves.js`): Stunned one round, Rooted and Poisoned two, Warded runs down with the rounds and has no save. A move lays Stunned or Rooted only when the foe fails that move's own save; there is no second roll. In the telling: a stun is a rung bell, a root is the ground taking hold, poison is a slow bad afternoon, a ward is somebody else's kindness. The Quarry Mark, Dirge of Doubt and Dirty Trick "takes 20-25% more" is a timed mark on the foe, not a condition, and has no badge. **Parley**: once a fight, a member may talk down a foe that can talk back (an enemy hero, bandits and brute-folk; never Kragmaw) with Persuasion or Intimidation against the foe's temper. It holds (fights on and turns on the speaker), breaks away and runs, or yields and leaves the party be.

## Specialisations (issue #82)
At level 10 a hero takes one of two paths for their class (`SPECS` in `src/data/classes.js`). A path is permanent. It adds a point to two ability scores, trains one more skill, and brings one passive and one more active ability, all learned at level 10 (rows of `src/data/moves.js` carrying `spec:`). The Chronicle and the hero's own log mark the choice. Scripted heroes choose by their traits and by what their party lacks (a party with no damage-dealer of its own favours the damage path); agent-played heroes see `status.specialisation` and choose with `choose_specialisation`. All names are plain-English coinages.

| Class | Path | Scores / skill | Passive | Ability | Gist |
| --- | --- | --- | --- | --- | --- |
| Warrior | **Warden** | Grit, Presence / Empathy | Warden's Vow (+5% Defense, +4% Health) | **Shield Cover** (ward a friend, 55%) | the one who stands guard |
| Warrior | **Reaver** | Brawn, Reflex / Tracking | Reaver's Fury (+5% Crit, +15% opener) | **Cleaving Sweep** (90% to every foe beside you) | trades safety for killing speed |
| Mage | **Runescribe** | Wits, Reflex / Perception | Great Runes (+5% Crit, +20% opener) | **Twin Lance** (150%, +20% crit) | writes the runes large and strikes first |
| Mage | **Rimekeeper** | Wits, Grit / Survival | Frostbound (+4% Defense, +6% Health) | **Winter's Hold** (one foe loses 5 s) | frost that holds a foe still |
| Hunter | **Stalker** | Insight, Reflex / Traps | Steady Aim (+7% Crit) | **Heartseeker** (240%, +20% crit) | the patient single shot |
| Hunter | **Trapper** | Wits, Insight / Lore | Ground-Lore (+4% Defense, blows at 96%) | **Thornfield** (50% and 3 s to every foe near) | snares a whole pack |
| Priest | **Battle-Cleric** | Brawn, Presence / Athletics | Zeal (+6% Health, +4% Crit) | **Dawnbrand** (210%, foe reels) | faith carried into the fight |
| Priest | **Mender** | Insight, Presence / Empathy | Tenderness (healing +20%) | **Mending Touch** (heal one friend) | gives everything to the wounded |
| Rogue | **Cutthroat** | Reflex, Brawn / Perception | Deadly Opening (+4% Crit, +25% opener) | **Backstab** (220%, +30% crit) | lives for the opening |
| Rogue | **Trickster** | Wits, Presence / Lore | Nimble (blows at 92%) | **Dirty Trick** (foe loses 3 s and takes 20% more for 8 s) | wins by misdirection |

The **Warden** path is a living warrior's vow to stand guard over friends; it has nothing to do with the undead wardens of the Sunken Crypt (Lich-Warden Vesk and his Grave Wardens), who guard the dead. The word is shared, the calling is not. Trapper: Thornfield now also opens on one worthwhile foe (an elite, a boss, a duellist or a mob near the Trapper's level), not only on a pack; Mender: Mending Touch answers a friend below 72% health.

### Level-15 capstones (issue #713)
Each path learns a second ability at level 15 (rows of `src/data/moves.js` carrying `spec:` and `lvl:15`), the longest cooldown of the hero's list, a heavier version of what the path already does. All names are plain-English coinages.

| Path | Capstone | Gist |
| --- | --- | --- |
| Warden | **Gatewall** | the shield planted as a gate: every friend within five tiles takes blows at 72% for 8 s |
| Reaver | **Red Harvest** | a reaping circle: 140% to every foe at your side, costs 8% of your health |
| Runescribe | **Last Rune** | the rune that ends the sentence: 320%, +15% crit |
| Rimekeeper | **Deep Winter** | winter on the whole fight: 50% and 4 s to every foe within four tiles (a save halves the delay; at the Table a failed save stuns) |
| Stalker | **Hawkfall** | the arrow that drops like a stooping hawk: 340%, +25% crit |
| Trapper | **Deadfall** | a hidden pit and a weighted log: 80% and 7 s on one foe (at the Table it roots) |
| Battle-Cleric | **Bell of Reckoning** | a bell struck once over the fight: 120% and 1.5 s to every foe within two and a half tiles |
| Mender | **Second Dawn** | the light comes up again: every friend within five tiles heals 24 + 4 per level + 12% of their health |
| Cutthroat | **Last Whisper** | the blow it never hears: 400%, +20% crit, on a fresh, unhurt foe |
| Trickster | **Mirror Trick** | three of you and none where the blade falls: foes on you lose 3 s, blows land at 40% for 4 s |
| Warchanter | **Battle-Saga** | the saga at full voice: 110% and 1 s to every foe within three and a half tiles |
| Soothsinger | **Evensong** | the last song of the day: every friend within five tiles heals 14 + 3.5 per level + 8% and takes blows at 88% for 6 s |
| Thornbinder | **Thornstorm** | briars in a storm: 90% and 2.5 s to every foe within four tiles (at the Table it roots) |
| Springwarden | **Heart of Spring** | the green heart of the wood opens: friends within five tiles take blows at 70% for 8 s and are mended a little |

## Skald (issue #83)
The sixth class: a **Skald** is a war-singer, one of the road-poets who march behind a shield wall and make the fight easier to bear. Not a healer and not a mage: the voice is the weapon, and the work is done to the whole company at once. In the Fellowship a Skald is a DPS pick (Mage, Hunter, Rogue or Skald); the three DPS places still prefer three different classes. Ability score Presence (then Wits); trained in Persuasion, Lore, Intimidation and Perception. Mid health, a medium reach of about three tiles, no armour training (light gear, hide and cloth like a Rogue: armour weight .25, the main hand carries the weapon damage). Skald gear nouns (#274, `SLOT_NOUNS` in `src/data/items.js`): Cap (head), Doublet (chest), Bracers (hands), Marchboots (feet), Warhorn (main hand), Songstone (off hand, a hand-sized stone that rings when struck) and Lutecharm (trinket). Banner colours: rose and plum, with a gold-bodied lute carried on the right.

| Kind | Name | Level | Gist |
| --- | --- | --- | --- |
| Verse | **Biting Verse** | 1 | a sung blow, 170% damage and a flinch of 0.6 s |
| Verse | **Rallying Verse** | 3 | the whole company within five tiles takes blows at 85% for 8 s |
| Verse | **Dirge of Doubt** | 6 | one foe loses 1.5 s and takes 20% more for 8 s (a save resists) |
| Passive | **Practised Ear** | 2 | +5% Crit |
| Passive | **Last Verse** | 7 | under half health, blows land at 80% |

Paths at level 10:

| Path | Scores / skill | Passive | Ability | Gist |
| --- | --- | --- | --- | --- |
| **Warchanter** | Presence, Brawn / Intimidation | Field Voice (+4% Crit, +20% opener) | **Roaring Chant** (80% to every foe within three tiles) | sings the fight forward |
| **Soothsinger** | Presence, Insight / Healing | Soft Refrain (healing +15%, +5% Health) | **Lullaby of the Hearth** (heals every friend within five tiles) | sings the party back together |

Skald is a generic fantasy role (the word is an old one for a poet of war); the abilities, paths and quirks here are Eldmoor's own. Soothsinger is not a Priest: the lullaby is a small mercy for a whole company, where a Priest's healing is aimed and large.

Voice (`CLASS_BARKS` in `src/data/barks.js`, spot, flee, duel, idle, plus mourn): the Skald treats everything as a song, with verses, refrains and keys, and cheerfully offers a foe a place in the next one; Concord Skalds are rueful and exact, Warband Skalds loud. Never a franchise bard's phrase.

## Wildspeaker (issue #83)
The seventh class: a **Wildspeaker** is a hedge-and-hollow healer, one of the walkers who learned the green words from old gardens, field edges and the stubborn groves the roads cut through. Where a Priest asks light of the heavens, a Wildspeaker asks it of the ground: moss, bramble and root. In the Fellowship a Wildspeaker is the other choice for the Healer place (Priest or Wildspeaker). Ability score Insight (then Grit); trained in Healing, Survival, Tracking and Empathy. Sturdier than a Priest (health 52) with a shorter reach of about two and a half tiles. Mends one friend at a time and holds foes in place, where the Priest's strength is the mass mend. Banner colours: moss and teal, with a crooked staff whose head curls over like a fern.

| Kind | Name | Level | Gist |
| --- | --- | --- | --- |
| Ability | **Briar Lash** | 1 | a whip of living bramble, 150% damage and a flinch of 0.6 s |
| Ability | **Greenmend** | 3 | heals one friend within five tiles, 14 + 3.5 per level + 8% of their health |
| Ability | **Rootbind** | 6 | 30% damage and the foe loses 3 s (half on a save) |
| Passive | **Barkskin** | 2 | +5% Defense |
| Passive | **Green Patience** | 7 | healing +10% and +4% Health |

Paths at level 10:

| Path | Scores / skill | Passive | Ability | Gist |
| --- | --- | --- | --- | --- |
| **Thornbinder** | Wits, Reflex / Tracking | Barbed Bramble (+4% Crit, +15% opener) | **Ring of Thorns** (70% damage and 1.5 s to every foe within three tiles) | calls the briars up around the fight |
| **Springwarden** | Insight, Grit / Empathy | Evergreen (+6% Health, healing +10%) | **Antler Ward** (every friend within five tiles takes blows at 80% for 6 s) | keeps the company standing |

Wildspeaker is a generic fantasy role; the abilities, paths and quirks here are Eldmoor's own. The **Springwarden** path shares the word "warden" with the Warrior's Warden path and the Crypt's Grave Wardens, and nothing else: it is a green crown over friends, not a sworn guard.

Voice (`CLASS_BARKS` in `src/data/barks.js`, spot, flee, duel, idle, plus mourn): the Wildspeaker talks to ground, root and bramble, misses living green in a city, and plants a seed where a friend falls, so that something grows to mark the place; the habit grew from a grove the Wildspeakers' teachers once saw burned, and they have planted at graves ever since. Concord lines are gentle and dry, Warband lines clipped.

## Bonds and blood debts
Heroes who fight side by side grow fond of each other (`src/sim/bonds.js`). Shared kills,
heals, rescues in a duel and setting out in a party raise a bond; a day apart wears it
down. Six points make friends, fifteen make sworn companions, and the Chronicle says so
when the line is crossed. When a hero falls to an enemy hero, the sworn companions take
the killer as a nemesis and friends do so half the time, so the grudge outlives the dead
and is hunted on sight ("spots X, who killed their friend Y, and charges"). The closest
friend swears the death will be paid for. Whoever finally kills the killer has paid the
blood debt, and the dead hero's friends warm to them. A grudge ends only with the killer.

## Wounds and the chapel (issue #656)
A hero brought down and brought back carries a lasting wound for days: less health, a slower step and a slower arm. Healers and the fire shorten it. In town the Priest (the Shaman, in Warband towns) dresses wounds at the chapel for a few coins; no one there raises the dead, and no one ever will.

## Zones
| Zone | Levels | Description |
| --- | --- | --- |
| Thornvale | 1-5 | Green woods and meadows between the capitals and the river. |
| Mirefen | 6-10 | Swamps and mud flats east of the river. Contested; most PvP happens here. |
| Cinderpass | 11-15 | Volcanic rock and peaks in the east. |
| Hoarfell | 16+ | Wind-scoured snowfields and frozen tarns north of the fen and the pass. |

The Stepping Lands, a larger test continent with six regions of its own (Lowmark, Sedgewater, Cairnwold, Cinderreach, Rimeholt, Palereach), are listed under Landmarks.

## World events (issue #335)
The DM can start a **festival**, a **plague**, a **migration** or an **invasion** over a region (the lever `start_event`); both are the region conditions of the same names. A **festival** (3 game days, longer at a higher scale up to 9) fills the market towns: townsfolk talk more and merchants walk the roads in place of ambushes. A **plague** (the same lengths) sends townsfolk indoors and turns road ambushes into lost pilgrims. A **migration** (same lengths) sets herds and packs moving across the whole region, so more beasts roam it; the chronicle says "The herds of Mirefen are on the move; packs and beasts roam the whole region." An **invasion** is raiders pouring into a region (it runs as the bandits condition): more road encounters, more of them ambushes; "Raiders pour into Mirefen; the roads grow dangerous." None of them touches anyone's health or life. The chronicle says so in plain words: "A festival fills the market towns of Thornvale." and "A plague creeps through Mirefen; townsfolk keep indoors."

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

## Road traffic

The people between the towns (issue #796). Nobody here fights or has a name of their own: they are presence, seen in passing.
Carters belong to neither faction and take their loads to any gate; the road is the one place the Concord and the Warband
buy from each other without a word said.

- **Carts** go by their load: a salt cart, a grain cart, an ale cart, a timber cart, a wool cart, a hide cart, a pelt cart, a silk
  cart, a moss cart. The last five carry what the auction house trades (Hoar Wool, Thick Hide, Wolf Pelt, Silk Bundle, Fen Moss).
- **Travellers** on foot: a pedlar, a pilgrim, a tinker, a drover, a road courier, a wandering minstrel. They also walk to the
  outposts and the dungeon mouths at the ends of the roads, and back. Nobody takes the road to a wyrm's lair for choice.
- **Guards**: a guard of the town on its gate road, day and night; a watchman of the nearest town on each bridge, by day.
- A cart that never arrives reads in the Chronicle as "A salt cart never came off the road in Mirefen."

## Landmarks
- **The Sunken Crypt**: dungeon in southern Mirefen. Boss: **Lich-Warden Vesk**. Groups of 4-5.
  - **The stair sign and the captain's word** (#448): the game never turns a company away from the stair for level; the danger is read in the world. A weathered sign is nailed to the stair-post: "Those who went below were tried blades; you are not. Turn back." A hero below Mirefen's band who sees the stair marks the Crypt dangerous in what it knows. The gate captain, asked by a green blade, says: "The Sunken Crypt is not a place for green blades. Those who went down before you were tried, and the stair has kept more of them than the bards admit. Grow first, then go, and go together."
  - **The crawl** (#65): when a company goes down, the Crypt is played as five chambers in order, each one a Table scene (background groups still make the single roll). Creatures are the Crypt's own: Tomb Skitters, Crypt Shamblers, Bone Archers, Grave Wardens and Lich-Warden Vesk. Levels 7-12.
    - **The Weeping Stair** (level 7+): water runs down the steps, Tomb Skitters scuttle in the dark below.
    - **The Ossuary**: shelves of old bone; Crypt Shamblers stand up from them.
    - **The Archers' Gallery**: a long gallery of arrow-slits and dry bowstrings; Bone Archers and a Shambler.
    - **The Drowned Court**: a floor of black still water, Grave Wardens standing in it to the knee (the court Ossian Vael drowned).
    - **The Vigil Chamber**: the last door; Lich-Warden Vesk with Tomb Skitters at his feet. He is a keeper holding Ossian Vael's oath, not a usurper (see the campaign seed), so his scene should read as a watch kept, not a lair raided. The boss fight's second phase is also called *The Drowned Court*: the same water, the same room, deliberately.
- **DM-made sites** (#69): the DM raises dungeon sites as the story needs them (`create_site`; `src/data/sites.js`). Each is a barrow, fortress, temple, mine, den or ruin on open ground off the roads, 3-8 chambers of the region's own creatures and the site foes of its kind, and a boss from the encounter tables' site bosses (the Grave-Sexton, Captain Redhand, the Veiled Cantor, the Cave Duchess, Mother Thistlewick, the Stone Steward and their stronger kin). It stands until a company clears it (a ruin is left for a while) or, left alone about ten days, it falls in on itself.
  - **Names** are built from a place word in the region's own vocabulary and the kind: *the Sedgemere Barrow*, *Cinderscar Hold*, *the Temple of Rimecairn*, *the Flinthearth Delvings*, *the Woldwick Den*, *the Ruins of Thornhollow*. Place words, first part then second, by the land: meadow (Thornvale) Thorn, Bramble, Oak, Hawk, Briar, Wold + hollow, ford, wick, dell, stead, ley; fen (Mirefen) Sedge, Reed, Murk, Eel, Bitter, Silt + mere, holm, fen, marsh, water, pool; ash (Cinderpass) Cinder, Ember, Slag, Soot, Char, Flint + crag, fell, gorge, scar, hearth, rock; tundra (Hoarfell) Rime, Frost, Hoar, Snow, Tarn, Winter + fell, cairn, reach, howe, moor, tor; any other land Grey, Stone, Black, Old, Raven, Wyrm + moor, holt, stead, cairn, dale, by. Never paired: a join that doubles a letter (Wold-dell, Frost-tor), a pair that names a region or town (Hoarfell, Sedgewater), Winterfell (another world's), Soothearth, Slagcrag, Brambleley, Rimereach, Oldmoor.
  - **Chambers** by kind (a site walks its plan in order): barrow: the Bone Passage, the Grave Niches, the Low Hall, the Sunken Floor, the Narrow Stair, the Door of Names, the Candle Alcove, the Grave-Goods Vault, the Barrow-Heart. Fortress: the Gatehouse, the Barracks, the Wall Walk, the Killing Yard, the Murder Holes, the Barred Postern, the Old Chapel, the Strongroom, the Great Hall. Temple: the Narthex, the Cloister, the Choir, the Flooded Aisle, the Fallen Nave, the Rune Door, the Lady Chapel, the Reliquary, the Sanctum. Mine: the Upper Gallery, the Ore Chute, the Long Seam, the Shaft, the Rotten Props, the Winch Room, the Miners' Shrine, the Tally Room, the Deep Seam. Den: the Run, the Gnawing Hollow, the Litter Cave, the Sinkhole, the Loose Scree, the Choked Passage, the Old Spring, the Hoard of Bones, the Deep Den. Ruin: the Broken Court, the Cellars, the Collapsed Hall, the Fallen Stair, the Sagging Gallery, the Sealed Study, the Household Shrine, the Hidden Strongroom, the Throne Room.
  - **Loot**: the boss always carries one epic: a barrow's or temple's from the Sunken Crypt's epics, the others from the region's own.
- **First delves** (#922; `src/data/prologues.js`): the short dungeon a new company plays before the open world, set by its hall and ended at about level 2 (plain loot, no epic). Each is a small, grounded chore, not a grand evil, and the gate captain's closing words point at the Sunken Crypt as the real thing. Four, one each:
  - **The Wick Barrow** (barrow), keeper **Old Tallow**, a village sexton who kept the barrow lamps for forty years and would not stop when he died. Belongs to Highgate, then any Concord hall. Rooms: the Lamp Passage, the Bearers' Niches, the Last Lamp.
  - **The Toll-House Cellars** (ruin), keeper **Hob Reckoner**, a greedy road-thief who burned the toll-house himself and dug in below with his cousins. Any Concord hall after Highgate's. Rooms: the Beer Cellar, the Tally Vault, the Strong Cellar.
  - **The Ashpit Den** (den), keeper **Mother Soot**, a scarred she-beast fat on the town's goats (a Den Mother, an animal, not a villain). Belongs to Grimhold, then any Warband hall. Rooms: the Ash Run, the Gnawing Hollow, the Warm Bed.
  - **The Slag Delving** (mine), keeper **Gaffer Crook**, a petty tyrant who led the rail-strippers and robbed the next shift. Any Warband hall after Grimhold's. Rooms: the Rail Gallery, the Scrap Heap, the Gaffer's Gallery.
  - A town added later gets its own row in the same table. Tone: Concord delves end with a warning, Warband delves with a sneer; death here is as final as anywhere.
- **Contested outposts** (#11): two watch-posts on the roads that belong to whichever faction holds them. **Fenmarch Cross** (Mirefen, levels 6-10): a weathered standing-stone cross on dry ground in the fen, off the roads. **Ashgate Watch** (Cinderpass, levels 11-15): a ruined gate-tower on the lair road. A faction takes one by holding its ring unopposed; a hero of both banners there freezes it. The holder's banner flies, its heroes heal faster nearby, and kills within a couple of tiles of an outpost count double honor.
- **Kragmaw's Lair**: lava ring in eastern Cinderpass. World boss **Kragmaw the Cinder Wyrm**, level 20, raided by 5-6 heroes of level 14+ (or four well-geared ones).

### The Stepping Lands (test continent, not the home map)
The Sunken Crypt of Sedgewater reuses the Eldmoor stair sign and gate captain's warning (#448); a placeholder on this test continent.

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
| Brinereach | Concord | Skerrin | A salt-reach fishing town of net-menders on the western bank of the Greywater, south of Cairnmoot. Its name was reserved in "Peoples of Eldmoor". |
| Grimhold | Warband | Ashfolk | As in Eldmoor, in the south-west corner. |
| Murkstead | Warband | Mirekin | A stilted salt-boilers' town at the fen margin, west of the Greywater. Its name was reserved in "Peoples of Eldmoor". |
| Thornteeth | Warband | Thornhide | A bone-carvers' ridge-town in the south-east of the fen country, on the road to the Sunken Crypt. Its name was reserved in "Peoples of Eldmoor". |

- **The Greywater**: the river that divides Lowmark from the fen and the upland.
- **Brinereach** (Stepping Lands town, Concord, Skerrin home, Lowmark, level 1-5): a salt-reach fishing town of net-menders on the west bank of the Greywater, road to the western hub. Not Eldmoor canon geography.
- **Thornteeth** (Stepping Lands town, Warband, Thornhide home, Sedgewater, level 4-9): a bone-carvers' ridge-town in the south, roads to Murkstead and the Sunken Crypt. Not Eldmoor canon geography.
- **The Sunken Crypt of the Stepping Lands** (level 4-9, Sedgewater): the same dungeon name, but the crawl here is three chambers of its own (#309), proving the rooms are data per world. Creatures are the Crypt species (Tomb Skitters, Crypt Shamblers, Bone Archers, Grave Wardens).
  - **The Reed Sump**: a flooded stair-foot choked with dead reeds; Tomb Skitters under the water-mat.
  - **The Salt-Bone Hall**: shelves crusted white with fen salt; a Crypt Shambler and a Bone Archer.
  - **The Mere-Warden's Seat**: a round pool with a stone chair in it; the boss room. **Mere-Warden Hask** (a Grave Warden, pitched for the 4-9 band though the species starts at level 7; deliberate, he is a named exception) keeps the watch while the fen rises, with a Tomb Skitter at his feet.
- **The Hollow Cairn** (level 8-13, Cairnwold): the second dungeon of the Stepping Lands, a barrow cut into the Cairnwold hills (#717); groups go down it since #891, tried blades of level 10 and up among the background. Four chambers, as data on the landmark; creatures are the Crypt species. The rooms are written, but a group can only go down the world's first dungeon until the engine learns a second (see the issue).
  - **The Cold Throat**: a low passage of fitted stones that breathes out cold; Tomb Skitters on the walls.
  - **The Ring of Heaped Stones**: a round hall of man-high burial heaps; two Crypt Shamblers and a Bone Archer.
  - **The Hall of Unlit Lamps**: rows of dead stone lamps; two Bone Archers and a Grave Warden behind the last row.
  - **The Cairn-Warden's Door**: the boss room, a great slab standing open. **The Cairn-Warden** (a Grave Warden, pitched above the party; a named exception like Mere-Warden Hask) keeps the door against the living and the dead, with a Crypt Shambler at its heel.
- **Brask Ironhorn, the Ram-King of the Cairnwold** (Cairnwold elite, level 15, kin Tundra Shaghorn): a crag-ram with one horn snapped and the other grown into his own shoulder. Placeholder.
- **Whitemaw, the Snow-Hound of Rimeholt** (Rimeholt elite, level 21, kin Rimehound): a pale, silent hound that hunts at the edge of sight. Placeholder.
- The other elites of the Stepping Lands are the Eldmoor four (Hollowfang in Lowmark, Old Mother Sedge in Sedgewater, Scoriath in Cinderreach, Ulfryn Coldmarrow in Palereach), re-levelled to their regions. Brinereach and Thornteeth are towns there (see the town table and entries above).

### The Wending Vale (third world, epic #940)
`VALE` in `src/world/spec.js` is a 184x60 map shaped for the owner's wide screen. One river, the **Wend**, rises from a spring in the high north-east and runs west to the sea off the map's west edge. The Concord holds the north bank, the Warband the south. Three crossings carry all travel: the **Low Bridge** at the home towns, the **Weirgate ford** in the middle (the only wading place, with the great dungeon beside it) and the **High Bridge** at the contested upper edge. Creatures are a first pass in `src/data/fauna.js`. Select it as the third world; geography is its own, not Eldmoor's. (Widened from 144 to 184 columns in #979 so the towns stand apart; the first cut, 144 wide, is gone and its saves cannot continue.)

| Region | Levels | Description |
| --- | --- | --- |
| Wendmouth | 1-5 | Meadow at the river's mouth in the west; the four home towns and the Low Bridge. Everyone starts here. |
| Sallowfen | 3-8 | Fen and willow-flats on the south bank. The Sallow Vaults lie in its edge. |
| Hawkwold | 3-8 | Windy highland on the north bank, facing Sallowfen across the water. The Kestrel Barrow is cut into its hills. |
| Greywood | 6-11 | Old wood and meadow in the middle vale, around the Weirgate ford. |
| Ashenfold | 10-15 | Ash-fields and cold slag where the old kilns burned. |
| Rimecrown | 14+ | The tundra crown above the High Bridge, squalls off the snow. The Wend rises here and Kragmaw's lair sits at its head. |

| Town | Faction | People | Notes |
| --- | --- | --- | --- |
| Aldermere | Concord | Hallowan | Alder-shaded home town in the north-west, first of the Concord towns on the Wend. A market green inside the walls, the forge and halls fronting a paved lane, the inn on the green's west edge. |
| Gullstrand | Concord | Skerrin | A gull-loud harbour town just south of Aldermere, at the river's mouth. Its gate faces the water: a street climbs from the quay and jetty to a lane under the halls. |
| Hawkstead | Concord | Tarrow | A falconers' upland market on the north bank, road to the Kestrel Barrow and the ford. Built on terraces, the chapel on the hall's shoulder and a stair up the middle. |
| Brandhold | Warband | Ashfolk | Brand-marked home town in the south-west, first of the Warband towns. A forge town with its gate in the north wall and one straight street to the yard before the inn. |
| Stiltmere | Warband | Mirekin | A stilted fen town in Sallowfen, road to the Sallow Vaults. Wide and loose, its buildings standing apart along planked lanes. |
| Hornridge | Warband | Thornhide | A horn-and-bone ridge-town on the south bank, road to the ford. A hold on a long slope, gate at the top and two terraces down to the inn. |

- **The Wend**: the one river of the vale; the name is the vale's too, the Wending Vale. **The Low Bridge, the Weirgate ford, the High Bridge**: its three crossings, west to east.
- **The Drowned Weir** (dungeon, level 7+ entry, south bank beside the Weirgate ford): the great delve, five chambers, a flooded sluice-works of green stone. Boss **Weir-Warden Orsk** (a Grave Warden of the old weir-keepers, named exception like Mere-Warden Hask). Chambers: **The Sluice Stair**, **The Millrace Gallery**, **The Weighing Hall**, **The Flooded Granary**, **The Weir-Warden's Chair**.
- **The Kestrel Barrow** (dungeon, level 4+, Hawkwold): a falconer-lord's grassed mound. Boss **Lord Merrin Hawkwright**. Chambers: **The Low Door**, **The Kestrel Niches**, **The Falconer's Mews**.
- **The Sallow Vaults** (dungeon, level 4+, Sallowfen): cellars under a burnt kiln, a smugglers' hold. Boss **Captain Dane Sallow**. Chambers: **The Eel Cellar**, **The Salt Tally**, **The Cold Store**.
- **The Brandwright Kiln** (dungeon, level 10+, Ashenfold): a great kiln still red at the heart. Boss **The Kiln-Warden**, a golem built to tend it. Chambers: **The Flue Gallery**, **The Ash Floor**, **The Kiln Heart**.
- **Weirgate Watch** (outpost, Greywood, level 6-11): the old guard-post on the north bank by the ford. **Kilnmark Cross** (outpost, Ashenfold, level 10-15): a crossroads post on the road to the Brandwright Kiln.
- **Kragmaw's Lair** (Rimecrown, level 20): the same wyrm and raid as Eldmoor, here at the river's head.
- **Greymane, the Pack-Father of the Hawkwold** (elite, Hawkwold, wolf): a grey wolf grown huge on the uplands' flocks. **Thornback, the Boar-King of the Greywood** (elite, Greywood, mud-boar): a tusked boar with a back like a hedge.
- **First delves of the Vale** (`src/data/prologues.js`, one a home town, each about level 2, plain loot): **the Drowned Millhouse** (Aldermere, ruin, keeper **Miller Quill**, a frightened miller run by river-thieves), **the Gull Cliff Den** (Gullstrand, den, keeper **Old Brine**, a sea-wolf mother), **the Herders' Cairn** (Hawkstead, barrow, keeper **Shepherd Wick**, an old herder counting lost sheep), **the Cold Forge** (Brandhold, mine, keeper **Slagmaster Brok**, a self-crowned smith), **the Salt Pans** (Stiltmere, ruin, keeper **Boil-Master Garr**, a short-weight smuggler) and **the Bone Pit** (Hornridge, den, keeper **Mother Rattle**, a goat-fat she-beast). Campaign seed: `docs/campaigns/vale.md`.
- **The Green Keeper** (DM-only figure, not a creature or a person): the green-cloaked toll-collector travellers meet at the Weirgate ford, who gives a receipt in an unreadable hand. It is what is left of Orsk's oath walking the crossings; as the oath thins it appears less and the Wend wanders more. No stats, no fight; the DM voices it. Unique within Eldmoor's canon.
- **The Vale's story in one line**: the Wend was moved long ago and the Drowned Weir was built to hold it in its new bed; Orsk's oath is failing, Kragmaw's heat is drying the spring, and the green stone to mend the weir is fired only in the Brandwright Kiln. Three endings: free the warden, relieve him, or mend the weir. Seed and secrets: `docs/campaigns/vale.md`. The title-screen blurbs for Eldmoor, Stepping and the Vale are `blurb:` in each spec.
- **Grimbrand, the Kiln-Golem of the Ashenfold** (elite, Ashenfold, level 17, golem kin): the last kiln-tender's guardian, gone wild when there was nobody left to tend. Slag-grey, cracked along the ribs, and one arm is still a bellows that wheezes before it swings. It walks the ash-fields between the old kilns as if still making its rounds.
- Dungeon boss chambers run longer at the table: the Kestrel Mews 3 rounds; the Weir-Warden's Chair, the Cold Store and the Kiln Heart 4 each.

#### Creatures of the Vale
Fauna of `src/data/fauna.js`: each region has its own creatures, levels, names and trade goods (goods in `VALE_GOODS`, Vale-only). Kin is the Eldmoor creature a species borrows its build and look from.

| Creature | Region | Levels | Drops | Quest | Kin |
| --- | --- | --- | --- | --- | --- |
| Strand Wolf | Wendmouth | 1-3 | Strandpelt | Wolves on the Strand | Timber Wolf |
| Reed Boar | Wendmouth | 2-4 | Reed-Tusk | Tusks from the Reeds | Bristleback Boar |
| Dyke Weaver | Wendmouth | 3-5 | Dyke Silk | Sweep the Dykes | Webspinner |
| Sallow Bogling | Sallowfen | 2-4 | Sallow Moss | Boglings in the Willows | Bogling |
| Sallow Hog | Sallowfen | 3-6 | Willow Hide | Hides from the Flats | Mudback Boar |
| Eel Lurker | Sallowfen | 5-8 | Eel Venom | Venom for the Stilt-Healers | Fen Lurker |
| Heath Wolf | Hawkwold | 2-4 | Heath Pelt | Wolves on the Heath | Timber Wolf |
| Crag Boar | Hawkwold | 3-5 | Crag Tusk | Tusks from the Crags | Bristleback Boar |
| Windhound | Hawkwold | 4-7 | Gale Sinew | Windhounds on the Ridge | Rimehound |
| Oak Weaver | Greywood | 6-8 | Oak Silk | Webs in the Old Wood | Webspinner |
| Thicket Boar | Greywood | 7-10 | Thicket Hide | Hides from the Thicket | Mudback Boar |
| Grey Stalker | Greywood | 9-11 | Greywood Fur | Stalkers of the Greywood | Timber Wolf |
| Ash Weaver | Ashenfold | 10-12 | Ash Silk | Webs in the Ash | Webspinner |
| Slag Golem | Ashenfold | 11-14 | Slag Core | Cores from the Slag | Cinder Golem |
| Ember Hound | Ashenfold | 12-15 | Ember Fur | Hounds of the Old Kilns | Timber Wolf |
| Squall Wolf | Rimecrown | 14-16 | Squall Pelt | Wolves in the Squall | Timber Wolf |
| Crown Hound | Rimecrown | 15-18 | Crown Rime | Howls on the Crown | Rimehound |
| Crown Wight | Rimecrown | 17-20 | Crown Marrow | What the Crown Keeps | Tarn Wight |

- **Wendmouth**: the strand wolves are salt-matted and bold, and the reed boars root up the dykes the farmers swear they mended last spring. Dyke weavers hang their webs between the sluice-posts, which is a nuisance to everyone but the flies.
- **Sallowfen**: boglings and hogs share the willow-flats in an uneasy truce; the eel lurkers are another matter. The Stilt-Healers of Stiltmere pay well for the venom and ask nobody how it was got.
- **Hawkwold**: the heath wolves follow the flocks up the slopes, the crag boars hold the broken ground, and windhounds run the ridge-tops so lean and fast that the falconers say the hawks give way to them.
- **Greywood**: the old wood is quiet in the wrong places. Oak weavers spin across the deer-paths, the thicket boars live in the hedge-tangles, and the grey stalkers wait where the trees go dark.
- **Ashenfold**: whatever the kilns burned, the fold has not forgotten it. Slag golems wander the cold floors with the patience of things nobody told to stop, and the ember hounds still den in the warm brick.
- **Rimecrown**: the squall wolves hunt inside the storm, crown hounds answer them from the snow, and what the crown wights leave is sold as marrow. As in Hoarfell, nobody in Hornridge asks what it is for.
- Elites of the Vale: Hollowfang (Wendmouth), Old Mother Sedge (Sallowfen), Greymane (Hawkwold, level 9), Thornback (Greywood), Grimbrand (Ashenfold, level 17) and Ulfryn Coldmarrow (Rimecrown) all stalk their regions; Hollowfang, Old Mother Sedge and Ulfryn Coldmarrow are the Eldmoor elites re-used and re-levelled, as in the Stepping Lands, the other three are the Vale's own.
- Name check (2026-11-05): no clash found in LORE.md or the repo; Grimbrand shares only the "brand" sound with Brandhold and the Brandwright Kiln, which suits it (the kiln-tender's guardian). No changes made to fauna.js.

- Name notes: Greywood stands beside Eldmoor's Greywater and Stepping's Greyreach by sound only; the town Wendmere of the test fixture shares the Wend root and stays reserved and unused.

### Test fixtures (not canon)
`TESTWORLD` in `src/world/spec.js` is a 40x30 fixture for the world generator check and never appears in the game. Its names are reserved so they are not reused for real places: **Lowmead** (meadow, 1-5), **Greyreach** (fen, 6-10), the town **Wendmere**, the brook, and the dungeon **The Barrow Gate** with its boss **The Barrow Reeve**.
`TESTLINK` in the same file is a pair of 32x24 fixtures for the linked-map checks (#1013), two tiny maps joined by one road each way; they never appear in the game or in `WORLDS`. Reserved: the maps **Linka** and **Linkb** (regions **Linka Mead**, **Linkb Mead**, 1-5), the towns **Hearthlink** and **Mooring**, and the exits **the east road** and **the west road**.

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

## Bestiary
Every creature has a stat block (`src/data/bestiary.js`): a **family** (what it is), a **role**
(how it fights), one to three **abilities**, what it resists or fears, how it behaves and what
it leaves behind. The field table above says where each lives; the bestiary says what it does.
The DM never invents a monster: dungeons and fights are filled from these blocks, and the
average creature of any level is exactly as tough as it ever was.

**Families:** beast, vermin, undead, elemental, brute-folk, bandit, wyrm.

**Roles.** A role tilts a creature's hide and bite; the mix in each zone keeps the average level.

| Role | Hide | Bite | Fights like |
| --- | --- | --- | --- |
| brute | high | slow, heavy | stands and trades blows |
| skirmisher | low | fast | darts, often in packs |
| caster | low | slow | spits, curses and poisons from a step away |
| swarm | very low | light | many at once |
| guardian | very high | slow | holds a place and shrugs off blows |
| leader | high | steady | rallies others; named foes and bosses |

**Abilities.** Slow, root, fear (the hero loses strikes), poison (damage over time), knockback
(hurled out of reach), summon (kin join the fight), heal (mends a hurt ally), breath (everyone
fighting it), frenzy (a rage when badly hurt).

| Ability | Effect | Used by |
| --- | --- | --- |
| Venom | poison over six seconds | Webspinner, Fen Lurker, Tomb Skitter, Cave Crawler, Hedge Caller |
| Web Snare | roots the hero | Webspinner, Cave Crawler |
| Howl | frightens a hero when kin are near | Timber Wolf, Rimehound, Den Mother |
| Gore | hurls the hero back | Bristleback Boar, Mudback Boar, tundra and bandit brutes, Tollbreaker |
| Frenzy | a rage below 45% hide | Mudback Boar, Reedcutter, Camp Captain, Den Mother, Hollowfang |
| Mire Grip | slows | Bogling |
| Hatch | brings forth two lesser kin | Fen Lurker, Old Mother Sedge |
| Slag Slam | slams the hero away | Cinder Golem |
| Ash Breath | fire on everyone fighting it | Ash Drake, Slag Mote |
| Rime Bite | slows with cold | Rimehound |
| Rimeblast | killing frost on everyone fighting it | Ulfryn Coldmarrow, Whitemaw |
| Bellow | frightens | Tundra Shaghorn, Camp Captain, Scoriath |
| Marrow Chill | drains over five seconds | Tarn Wight, Bone Archer |
| Grave Dread | frightens | Tarn Wight, Crypt Shambler, Grave Warden |
| Mend | heals a hurt ally | Grave Warden, Hedge Caller |

**Field creatures.**

| Creature | Family | Role | Abilities | Resists / fears |
| --- | --- | --- | --- | --- |
| Timber Wolf | beast | skirmisher | Howl; calls one packmate; breaks off at 15% | none |
| Bristleback Boar | beast | brute | Gore | none |
| Webspinner | vermin | caster | Web Snare, Venom | resists nature, fears holy |
| Bogling | brute-folk | swarm | Mire Grip; calls two kin | fears arcane |
| Mudback Boar | beast | brute | Frenzy, Gore | none |
| Fen Lurker | vermin | caster | Venom, Hatch | resists nature, fears arcane |
| Cinder Golem | elemental | guardian | Slag Slam | resists physical, fears arcane; slow to anger |
| Ash Drake | wyrm | caster | Ash Breath | resists arcane, fears physical blades |
| Rimehound | beast | skirmisher | Rime Bite, Howl; calls two packmates | fears arcane |
| Tundra Shaghorn | beast | brute | Bellow, Gore | resists physical; ignores heroes until they come close |
| Tarn Wight | undead | caster | Marrow Chill, Grave Dread | resists nature, fears holy |

Damage is tagged by who deals it: Warriors and Rogues physical, Hunters nature, Mages arcane,
Priests holy. Fire and cold are reserved for monster breath and, later, wands.

**Site foes.** Creatures of dungeons, camps and ruins rather than open country. They wear a
field species' shape and colours (a Reedcutter is built like a Bogling) and are not hunted
for quests.

| Creature | Family | Role | Abilities | Found in |
| --- | --- | --- | --- | --- |
| Crypt Shambler | undead | brute | Grave Dread | crypt, temple, ruin |
| Bone Archer | undead | caster | Marrow Chill | crypt, temple, ruin |
| Grave Warden | undead | guardian | Grave Dread, Mend | crypt, temple |
| Tomb Skitter | vermin | swarm | Venom | crypt, mine, ruin, den |
| Reedcutter | bandit | skirmisher | Frenzy | fortress, road, ruin |
| Tollbreaker | bandit | brute | Gore | fortress, road |
| Hedge Caller | bandit | caster | Mend, Venom | fortress, road, den |
| Camp Captain | bandit | leader | Bellow, Frenzy | fortress |
| Slag Mote | elemental | swarm | Ash Breath | mine, temple |
| Cave Crawler | vermin | skirmisher | Venom, Web Snare | mine, den |
| Den Mother | beast | leader | Howl, Frenzy | den |

**Rare elites** are a template on a base creature: about twice the hide, half again the bite,
slow mending, a wider ambush, a guaranteed epic and one extra ability: Hollowfang Frenzy, Old
Mother Sedge Hatch, Scoriath Bellow, Ulfryn Coldmarrow Rimeblast, Brask Ironhorn Gore,
Whitemaw Rimeblast.

**Named foes** (Old Notch and the rest) are a monster of the region as a leader, with a
signature ability on top of their kin's: Old Notch Frenzy, the Grey Widow Web Snare, Crookback
Gore, Longtooth Howl, the Quiet One Grave Dread, Ashjaw Ash Breath, Rimeclaw Rime Bite,
Mudmother Mire Grip, Halfhorn Bellow, the Thin Hunger Marrow Chill, Blackgums Venom, Old Rot
Hatch.

**Boss templates** (`src/data/bosses.js`): phases at hide thresholds, signature moves, adds,
an enrage timer and a named loot table.
- **Kragmaw the Cinder Wyrm**: one phase; a heavy blow every second and a half; Cinder Breath
  on the whole raid every seven seconds; no adds, no enrage; four named epics.
- **Lich-Warden Vesk**: three phases. *The Warden* (Grave Chill drains one hero, Warden's
  Dread frightens), *The Drowned Court* below 55% (the water in the crypt stands still and
  Grave Wardens rise from it), *Unbound* below 20% (he tears the phylactery from his own
  chest); enrages after four minutes. Loot: the Sunken Crypt epics.
- **Site bosses**, one set per theme and three tiers: crypt the Grave-Sexton, Marrowmother
  Ysolt, the Hollow Abbot; fortress Captain Redhand, Warden Brannock Sull, the Iron Reeve; den
  Mother Thistlewick, Long Ursel, Snowdam; mine the Cave Duchess, Slagheart, Emberdeep Kor; temple the
  Veiled Cantor, Ashen Prior Orsan, the Tarnkeeper; ruin the Stone Steward, Lord Orrick
  Dane, the Sundered Queen; road Black Tam, Sable Marrin, the Winter Reeve.

**Encounters and sites.** Themes: crypt, fortress, den, mine, temple, ruin, road. A fight is
bought with a budget: each creature costs by its role and by how far above the party it stands,
and a party of four spends about four ordinary foes' worth. A site is a run of rooms (guard,
trap, puzzle, treasure, shrine, boss), each with foes and loot, the boss room holding a named
epic.

**Special foes.** The DM may spend a few tweak points on a creature (rename, one or two more
levels, swap one ability, add one resistance), at most twice per region per day, always
written to the DM log. They are the exception, never the standard.

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
their bearer: a worn epic is raised to the hero's own level and a little more on its own, with no visit
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

### Armor, damage, bonuses and properties
Items carry no attributes of their own. Each piece carries some of four things:

- **Armor** (head, chest, hands, feet, and a Warrior's shield): more on the chest and head, less on hands and feet. Plate (Warriors) carries the most, leather (Hunters, Rogues) about a third of that, cloth (Mages, Priests) about a fifth to a quarter. All worn armor adds to Defense.
- **Damage** (the main hand, and a Hunter's longbow; a Hunter's hatchet and bow each carry half): adds to Attack.
- **Score bonuses** ("+1 Grit"): a fine piece has one +1, a rare piece two +1s or a single +2, and a trinket or a tome, censer or shiv in the off hand always adds +1 to the class's primary (trinket) or secondary (off hand) score.
- **One property** on every rare piece and on most epics: **swift** (+8% attack speed), **keen** (+3% crit), **warding** (+5% defense) or **vital** (+5% health).

Armor and damage grow with item level and quality; bonuses and properties do not.

Quality: **plain** (seven in ten drops), **fine** (about one in four: armor and damage +15% and one affix, shown in green) and **rare** (one in twenty: +35%, two affixes and a property, shown in blue). Town smiths sell plain and fine pieces; named elites drop fine or rare ones; epics are purple. An affix is a suffix in the voice of the zone, and it names the score it raises; affixes lean toward the scores the wearer's class values.

| Zone | Affixes (score raised) |
| --- | --- |
| Thornvale | of the Briar (Grit), of the Hollow Oak (Insight), of the Hare (Reflex), of the Wolf Run (Brawn) |
| Mirefen | of the Mire (Grit), of Still Water (Wits), of the Fen Light (Insight), of the Heron (Reflex) |
| Cinderpass | of the Ember (Brawn), of the Forge (Grit), of the Cinderfall (Presence), of the Slagwind (Reflex) |
| Hoarfell | of the Rime (Grit), of the Hoarwind (Reflex), of the Long Night (Wits), of the Drift (Presence) |

Epics are hand-made: each relic's armor or damage grows with its item level (armor counted as plate, so a relic shields a Mage as well as a Warrior), while its score bonuses and property stay fixed. At item level 20:

| Epic | Slot | At item level 20 | Flavour |
| --- | --- | --- | --- |
| Fang of the Old Wood | main | 18 damage, +1 Reflex, +1 Brawn, swift | Cut from a hollow oak's first limb; it hums when wolves are near. |
| Thornheart Longbow | off | 11 damage, +2 Reflex, keen | The string is wound with bramble fibre and never goes slack. |
| Bramblecrown | head | 26 armor, +2 Grit | Thorns turned inward, which is how a brave head is told from a foolish one. |
| Mosswoven Cloak | chest | 32 armor, +1 Grit, +1 Insight, vital | Grown rather than sewn; the bog keeps its wearer warm. |
| Bogwalker Boots | feet | 12 armor, +1 Reflex, +1 Grit, swift | The mud lets go of them a heartbeat early. |
| Fenlight Lantern | off | +2 Insight, +1 Wits, keen | A pale flame that shows where a foe is weakest. |
| Ember-Forged Greatsword | main | 20 damage, +2 Brawn | Quenched in Cinderpass ash; it is never quite cold. |
| Cinderscale Mantle | chest | 40 armor, +1 Grit, +1 Brawn, warding | Scales shed by something that did not need them any more. |
| Magma-Tempered Gauntlets | hands | 13 armor, +2 Brawn, swift | They glow when a grip is about to matter. |
| Rime-Etched Warpick | main | 19 damage, +1 Brawn, +1 Grit, keen | Frost patterns crawl up the haft with every swing. |
| Shaghorn Greatcloak | chest | 42 armor, +2 Grit, vital | Hide of the shaghorn, heavy as a promise to stay alive. |
| Icevein Diadem | head | 22 armor, +2 Wits, +1 Insight, keen | Cold enough to sharpen thought, and nothing else. |
| Vesk's Phylactery Shard | trinket | +2 Wits, +1 Grit, swift | A sliver of a lich that wanted to be remembered. |
| Drowned King's Signet | trinket | +2 Presence, +1 Insight, warding | Still wet, no matter how long it is worn. |
| Cryptbound Greaves | feet | 13 armor, +1 Grit, swift | Made to stand a long vigil, and to leave it quickly. |
| Staff of Still Water | main | 19 damage, +1 Wits, +1 Insight, swift | Not a ripple on it, even in the middle of a fight. |
| Kragmaw's Molten Eye | trinket | +2 Reflex, +1 Wits, keen | It still watches the lair it was torn from. |
| Wyrmbone Crown | head | 31 armor, +2 Grit, +1 Presence, warding | A crown for someone who has already won. |
| Cinder Wyrm Fang | main | 22 damage, +1 Brawn, +1 Reflex, swift | A tooth as long as a forearm, and twice as eager. |
| Mantle of the Ashen King | chest | 46 armor, +2 Grit, warding | Ash drifts from its hem and never reaches the floor. |

An item remembers where it came from (`src`: "Dropped by Hollowfang", "Bought in Highgate",
"Road merchant", "Looted from ...") and the piece it replaced, so the Gear tab can show both.

## Trade goods
Wolf Pelt, Boar Tusk, Silk Bundle, Fen Moss, Thick Hide, Venom Sac, Ember Core, Cinder Scale, Rime Pelt, Hoar Wool, Wight Marrow, Grave Dust.
Crafting materials (Redroot Leaf, Tin Ore, River Perch and the rest) are a separate list; see "Recipes and crafting materials".

Base prices climb with zone: Thornvale 4-7, Mirefen 9-14, Grave Dust 18, Cinderpass 22-26, Hoarfell 30-40.

## The pack (issue #124)
Every hero carries a pack (`a.inv`, `src/sim/inv.js`; 16 slots, 24 with a Wayfarer's Pack). One slot
holds a stack of up to 20 trade goods or supplies, or one piece of gear (a spare, an upgrade for a
companion, a piece still too high to wear). Gold is kept apart. Quest items ride in the pack too
and are never sold, dropped or given.

**Supplies** (`USES` in `src/data/items.js`, sold in every town, found on the road):

| Name | What it does | Price | From level |
| --- | --- | --- | --- |
| Redroot Draught | Heals 35% of health, in a fight or out | 8g | 1 |
| Marrowmend Tonic | Heals 55% of health, in a fight or out | 26g | 10 |
| Linen Bandage | Heals 20%, only out of a fight | 3g | 1 |
| Trail Ration | Heals 20% at camp | 3g | 1 |
| Pitch Torch | Lit at camp; the watcher's Perception check is 3 easier | 3g | 1 |
| Bogroot Antidote | Cures venom and rot | 8g | 3 |
| Scroll of Hearthward | Carries the reader to their home gate | 25g | 4 |
| Scroll of the Steadfast Hour | Blows taken -25% for 40 seconds | 22g | 6 |
| Wayfarer's Pack | +8 pack slots (one per hero) | 60g | 5 |

The herbwives of the Thornvale roads swear by redroot; hearthbloom and cold-water silt go into the
tonic. Hearthward is read aloud, the Steadfast Hour is a short-lived ward in a small hand.

**Quest items.** A job's own object travels with the leader: a sealed letter, the captain's writ, a
ledger, a bone reliquary, a surveyor's brass chain and the rest of the `things` lists of the Deliver
and Recover-a-relic jobs. The DM can also place a token from a short table, and take it back:

| Name | Flavour |
| --- | --- |
| Rookscar Toll-Token | A bent copper disc stamped with a rook. Toll-crews wave a bearer through. |
| Chapel Tithe-Seal | A wax seal for a tithe box that has not yet been found. |
| Cairn-Door Key | Cold iron, notched twice. It fits no lock in any town. |
| Shrine Candle-Stub | Lit once at a wayside shrine; the wick still remembers. |

## Professions (issue #254, epic #238)
A hero may hold two trades, each with a skill from 1 to 100 that rises with use. Names are generic and provisional until lore-keeper has checked them.
- Gathering: Herbalism (herbs, moss, flowers), Mining (ore and stone), Skinning (hide, sinew, bone), Fishing (river, mere and sea).
- Crafting: Alchemy (potions, cures), Smithing (weapons, armor, tempering), Leatherworking (cured hide: armor, straps, packs), Cooking (camp meals that hearten the company), Scribing (scrolls, maps).
- Skill bands used by recipes and nodes: 1-24, 25-49, 50-74, 75-99, 100.
- Gathering nodes (issue #255): four kinds, plain descriptions rather than proper names: Herb patch (Herbalism), Ore vein (Mining), Game trail (Skinning), Fishing spot (Fishing). They sit in the open land of every region, in the region's level band: Thornvale band 0, Mirefen 1, Cinderpass 2, Hoarfell 3 (the Stepping Lands the same ladder). Fishing spots stand on the banks of the river (Eldmoor's river runs through Thornvale, Mirefen and Hoarfell; Cinderpass has no water, so no fish); a sea coast would add more when a world has one. Nothing is gathered on a road, in a town or at the Crypt and Kragmaw's lair. A spent node grows back after a set time (herbs 4 game hours, ore 8, game trails 3, fish 2).

### Recipes and crafting materials (issue #256)
Crafting materials (`MATERIALS` in `src/data/items.js`) are a separate list from the trade goods above: trade goods are
sold to the auction house as loot, materials are gathered or dropped and consumed by recipes. A recipe may use both
(Wolf Pelt, Thick Hide, Fen Moss, Venom Sac, Ember Core, Rime Pelt and Hoar Wool are trade goods that recipes also eat).
Materials come from gathering nodes by kind (herb, ore, hide, fish; never by position) and from creature drops
(`MAT_DROPS` in `src/data/bestiary.js`).

| Material | Kind | Where it is found | Flavour |
| --- | --- | --- | --- |
| Redroot Leaf | herb | gathered (herb nodes, #255), skill band 0 | What the herbwives boil for the Redroot Draught. Bitter, red to the stem. |
| Rushpulp | herb | gathered (herb nodes, #255), band 0 | Beaten reed fibre; scribes press it into rough paper. |
| Hearthbloom | herb | gathered (herb nodes, #255), band 1 | A small orange flower that opens only near a warm hand. |
| Rimebloom | herb | gathered (herb nodes, #255), band 3 | Pale blue, grows through frost and tastes of it. |
| Tin Ore | ore | gathered (ore nodes, #255), band 0 | Soft, dull and plentiful. Every smith's first lesson. |
| Bogiron Ore | ore | gathered (ore nodes, #255), band 1 | Rust-red nodules dredged from peat; fights back against the hammer. |
| Cinderite | ore | gathered (ore nodes, #255), band 2; also dropped by Cinder Golems (30%, Cinderpass) | Black glassy ore that is warm to the touch long after it was dug. |
| Icevein Ore | ore | gathered (ore nodes, #255), band 3 | Blue-streaked rock that never quite thaws. |
| Wolf Sinew | hide | Timber Wolves (Thornvale, 25%, taken by a Skinner); also gathered (hide nodes, #255), band 0 | Dried and twisted into thread and bindings. |
| Mudback Bristle | hide | Mudback Boars (Mirefen, 25%, taken by a Skinner); also gathered (hide nodes, #255), band 1 | Coarse and stiff; stitched into straps and pack edges. |
| Shaghorn Horn | hide | Tundra Shaghorns (Hoarfell, 20%, taken by a Skinner); also gathered (hide nodes, #255), band 3 | A ridged horn, polished into toggles and trim. |
| River Perch | fish | gathered (fish nodes, #255), band 0 | Common, quick to cook, better than nothing. |
| Mere Eel | fish | Boglings (Mirefen, 15%, dropped whole); also gathered (fish nodes, #255), band 1 | Slick, muddy, and said to be best cooked quickly and not looked at. |
| Tarn Whitefish | fish | gathered (fish nodes, #255), band 3 | Firm cold-water fish with pale flesh. |

Source rule: the data fixes a material's node kind and skill band, never a place. Zone names above come only from where
the dropping creature lives (`MOBS` zone index 0 Thornvale, 1 Mirefen, 2 Cinderpass, 3 Hoarfell). Only five creatures
carry `MAT_DROPS`: wolf, mudboar, shaghorn, bog, golem. The trade goods recipes also eat (Wolf Pelt, Thick Hide, Fen
Moss, Venom Sac, Ember Core, Rime Pelt, Hoar Wool) are ordinary creature loot, not in this table.

**Crafted consumables** (`USES` rows with `craft:true`):

| Name | What it is |
| --- | --- |
| Rimeblood Elixir | A potion of rimebloom and hearthbloom; warms the blood against the cold. |
| Spit-Roast Perch | A camp meal on a stick. Plain and honest. |
| Fenmire Eel Stew | A camp meal; the name is the camp cook's joke, the recipe is serious. |
| Tarn Whitefish Chowder | A camp meal; the best the Hoarfell camps can offer. |
| Hoarfell Survey Chart | A scribed map of the high country that tells a reader where they are. |
| Fenwater Salve | A thin green potion of redroot in fen-water (crafted, skill band 1). |
| Wightbone Philtre | Tarn Wight marrow cut with rimebloom; the strongest crafted draught (band 4). |
| Hearthbloom Fish Pie | A camp meal of perch in a petal crust; sharpens the eye (band 1). |
| Tarn Hunter's Feast | A Hoarfell hunter's winter-march meal of whitefish and eel (band 4). |
| Scroll of the Brief Ward | A hurried, weak ward (band 1). |
| Scroll of the Unbroken Line | A strong ward inked with grave dust (band 4). |

**Crafted gear pieces** (`CRAFT_GEAR` rows for skill bands 1 and 4; a gear row, not a consumable):

| Name | Slot | Item level | What it is |
| --- | --- | --- | --- |
| Mireforged Greaves | feet | 8 | Fen-forged boots of tin and bogiron (smithing band 1). |
| Boarhide Buckler | off hand | 7 | A small round shield of wolf pelt and mud-boar bristle (leatherworking band 1). |
| Rimesteel Greatblade | main hand | 20 | A frost-hard master's weapon of icevein and cinder scale (smithing band 4). |
| Shagmane Hood | head | 20 | A master's hood of hoar wool and shaghorn horn (leatherworking band 4). |

**Crafted gear** (`CRAFT_GEAR`): Tinforged Weapon, Bogiron Handguard, Ashsteel Cuirass, Wolfhide Cowl, Hoarfrost Greatcoat.
Tinforged is a new material word (tin-forged, the plain first alloy of a new smith, sitting below Bogiron in the
Thornvale tier); the other material words are the existing ones under Equipment.

**Recipes** (`src/data/recipes.js`, one table for all five crafting trades; the smith of #13 adds prices on top of it, not a second table). Band is the skill band needed (0 = 1-24, 1 = 25-49, 2 = 50-74, 3 = 75-99).

| Trade | Recipe id | Band | Uses | Makes |
| --- | --- | --- | --- | --- |
| Alchemy | draught-redroot | 0 | 2 Redroot Leaf | Redroot Draught |
| Alchemy | tonic-marrowmend | 2 | Hearthbloom, Fen Moss | Marrowmend Tonic |
| Alchemy | elixir-rimeblood | 3 | Rimebloom, Hearthbloom | Rimeblood Elixir |
| Smithing | forge-tinforged | 0 | 3 Tin Ore, Wolf Sinew | Tinforged Weapon |
| Smithing | forge-bogiron | 2 | 3 Bogiron Ore, Thick Hide | Bogiron Handguard |
| Smithing | forge-ashsteel | 3 | 3 Cinderite, Icevein Ore, 2 Ember Core | Ashsteel Cuirass |
| Leatherworking | cure-wolfhide | 0 | 2 Wolf Pelt, 2 Wolf Sinew | Wolfhide Cowl |
| Leatherworking | stitch-pack | 2 | 2 Thick Hide, 2 Mudback Bristle | Wayfarer's Pack |
| Leatherworking | cure-hoarfrost | 3 | 3 Rime Pelt, 2 Hoar Wool, Shaghorn Horn | Hoarfrost Greatcoat |
| Cooking | meal-perch | 0 | 2 River Perch | Spit-Roast Perch |
| Cooking | meal-eel-stew | 2 | Mere Eel, Fen Moss | Fenmire Eel Stew |
| Cooking | meal-chowder | 3 | Tarn Whitefish, Redroot Leaf | Tarn Whitefish Chowder |
| Scribing | scroll-hearthward | 0 | 2 Rushpulp, Redroot Leaf | Scroll of Hearthward |
| Scribing | scroll-steadfast | 2 | Rushpulp, Venom Sac | Scroll of the Steadfast Hour |
| Scribing | chart-hoarfell | 3 | 3 Rushpulp, Venom Sac | Hoarfell Survey Chart |
| Alchemy | salve-fenwater | 1 | 2 Redroot Leaf, Fen Moss | Fenwater Salve |
| Alchemy | philtre-wightbone | 4 | Rimebloom, Wight Marrow, Hearthbloom | Wightbone Philtre |
| Smithing | forge-mireforged | 1 | 2 Tin Ore, 2 Bogiron Ore | Mireforged Greaves |
| Smithing | forge-rimesteel | 4 | 3 Icevein Ore, 2 Cinder Scale, 2 Ember Core | Rimesteel Greatblade |
| Leatherworking | cure-boarhide | 1 | 2 Wolf Pelt, 2 Mudback Bristle | Boarhide Buckler |
| Leatherworking | cure-shagmane | 4 | 3 Hoar Wool, 2 Shaghorn Horn, Cinder Scale | Shagmane Hood |
| Cooking | meal-bloom-pie | 1 | 2 River Perch, Hearthbloom | Hearthbloom Fish Pie |
| Cooking | meal-hunters-feast | 4 | 2 Tarn Whitefish, Hearthbloom, Mere Eel | Tarn Hunter's Feast |
| Scribing | scroll-brief-ward | 1 | 2 Rushpulp, Fen Moss | Scroll of the Brief Ward |
| Scribing | scroll-unbroken | 4 | 3 Rushpulp, Grave Dust, Venom Sac | Scroll of the Unbroken Line |

**Where things are made (issue #258).** Every recipe can be made at the workshops of a friendly town; at a camp fire only
cooking and alchemy (a meal over the coals, a draught in a pot). A crafted piece of gear takes the crafter's class noun
(or the class of the companion it was made for): a smith's Tinforged Weapon comes out as a Tinforged Longsword for a
Warrior, a Tinforged Mace for a Priest. It carries its maker's name ("Crafted by Kerin"), so a gift between companions
is remembered. A camp meal mends a little and gives a short edge (a quicker hand, a tougher hide, a sturdier frame) that
fades within a few hours; a hero eats one meal at a time. Herbalists tend toward alchemy (about half the mages and
priests among them toward scribing), miners toward the forge, skinners toward leatherwork and fishers toward the cook-pot; a crafter short of
herbs or ore buys them at the auction house.

Name check (2026-11-02): all of the above pass; no franchise proper nouns, no duplicates inside canon. Nits: "Fenmire"
sits one letter-shuffle from the zone Mirefen (kept as the cook's joke, but never use it as a place name); Rimebloom and
Rimeblood differ by one syllable (plant and potion, kept); "Shaghorn Horn" repeats itself, acceptable as a trade-name.

## Beasts of the yard and field, and town life (issue #795)

Ambient animals that are not creatures of the bestiary: nothing fights them and nobody hunts them. Town yards keep chickens, dogs, cats and goats; the open country keeps deer and hares (meadow, highland, tundra; the tundra hare is white), and crows and gulls (gulls by water). Hares and deer bolt from a hero and come home; birds take wing and glide back later. A few trees hold roosting birds that burst out when a hero passes. Each town's gate is flanked by two guards in a tabard of the town's colours, a third walks the wall opposite, the smithy's forge smokes through the working day, the inn's hearth at breakfast and from the afternoon, stalls open in the plaza in market hours (shut in rain and at night), lamps are lit at dusk and a pennant flies over the hall. No new named people or places.

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
the job: Old Notch, the Grey Widow, Crookback, Longtooth, the Quiet One, Ashjaw, Rimeclaw,
Mudmother, Halfhorn, the Thin Hunger, Blackgums, Old Rot, each with a title such as "terror of
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

### Goods jobs (issue #720, epic #238)

Not every job is a walk. Some boards ask for goods: crafted by a hero's trade or dug, cut and
caught with their own hands. No scenes and no party; a hero takes the posting, brings the goods
to the town that posted it, and is paid at the counter (templates `SUPPLY` in
`src/data/adventures.js`). The Chronicler files them under "errands" and is dry about it.

| Job | Asks for | Given by | The giver adds |
| --- | --- | --- | --- |
| Draughts for the chapel | Redroot Draughts (alchemy) | priest, innkeeper | "The chapel's shelves are bare after the last fever." |
| Tonics for the sick-room | Marrowmend Tonics (alchemy) | priest | "Bad cuts, and nothing left to knit them." |
| A blade for the gate | a Tinforged Weapon (smithing) | gate captain, quartermaster | "The watch's steel is notched past mending." |
| A cowl for the gate | a Wolfhide Cowl (leatherworking) | gate captain | "The winter watch wants something warm for the post on the wall." |
| Suppers for the road | Spit-Roast Perch (cooking) | innkeeper, quartermaster | "A drover train is in, hungry and not particular." |
| Wards for the chapel | Scrolls of Hearthward (scribing) | priest, bard | "The chapel hands them to travellers who ask." |
| Redroot for the herbwives | Redroot Leaf (herbalism) | priest, innkeeper | "The herbwives cannot keep up with the cut." |
| Ore for the forge | Tin Ore (mining) | smith, quartermaster | "The forge is cold until someone brings it ore." |
| Sinew for the saddlers | Wolf Sinew (skinning) | quartermaster, smith | "Harness, stitching, and not a strand to be had." |
| Perch for the inn | River Perch (fishing) | innkeeper | "The kitchen wants them whole and cold." |
| A Rimebloom patch | Rimebloom (herbalism, band 3) | priest | "A drover saw a patch of it above the tarn, blue in the snow." |

Crafted-goods jobs sometimes pay in the raw stuff the next batch wants (Hearthbloom, Fen Moss, Tin
Ore, Wolf Sinew, River Perch, Rushpulp); gathering jobs pay gold only. The Rimebloom hook's "the
tarn" is one of Hoarfell's frozen tarns (see Zones), where Tarn Wights climb out of the ice; the
priest does not mention that. Titles read like "Three Redroot Draughts for the chapel" or
"Five Redroot Leaf, fresh".

## The DM's hand
The Dungeon Master does not reach into the world freely. It has a short list of levers
(`src/sim/levers.js`), each with hard limits, a cooldown and a written reason, and every pull,
granted or refused, goes into the DM log.

**What the DM can change**
- **People.** Place someone in the world: a peddler, hermit, drover, sellsword, minstrel or a
  plain stranger, visiting a town, camped in the wilds or standing on a road, friendly, neutral,
  wary or hostile. Send them away again. Turn any person's mood toward a hero, a party or a
  whole faction for a while: a hostile face makes talk harder (+3 to the roll needed), a wary
  one a little harder, a friendly one easier (-2). Townsfolk keep their posts; only the DM's own
  people can be sent away.
- **Places.** Mark a ruin, a camp, a shrine, a cairn door or a watchtower on open ground, never
  in a town or at its gate. Markers sit on top of the land; the land itself does not change.
- **Danger.** Mark a stretch of road dangerous (more Rookscar ambushes, a few more of the
  region's own beasts, never stronger than the region allows) or cleared (ambushes there become
  quiet shrines, and the local dens move out past its edge), for up to two days.
- **Conditions.** Lay one condition over a region for up to three days (a festival, plague, migration or invasion started with start_event runs 3 to 9 days, see World events): bandits on the roads,
  plague (townsfolk keep indoors, the roads fill with lost pilgrims), a festival (talkative
  townsfolk, merchants instead of ambushes), a migration (more beasts on the move) or fog-bound
  skies (everyone sees less).
- **Trade.** Flood the auction house with one good or make it scarce for some hours.
- **Jobs.** Post a job on a town board, aimed at a place or a person, for a small, fair or
  generous purse; take a job down.
- **Foes.** Raise the named beast an adventure calls for, or a special foe from the bestiary
  with a few tweaks, always kept to the region's level band.
- **Tokens.** Put a quest item from the short table (a toll-token, a tithe-seal, a cairn-door
  key, a candle-stub; see The pack) in a living hero's pack, or take it back. A token has no
  numbers and cannot be sold, dropped or given.

**What the DM cannot do**
Kill a hero or save one, change anyone's health, experience, level, scores or class, bend the
one-life rule, reshape the land, or hand out treasure the item tables do not hold. No lever
exists for any of it.

**How the scripted DM uses them.** A lost escort leaves its road marked dangerous for a day,
and two lost in one region in a day bring bandits onto its roads. A cleared den is marked
cleared. A caravan brought through, or a robbed wagon's trail followed to the end, fills the
stalls with one good for a few hours. A stranger angered at a parley may make camp by the
road and stay there, nursing the grudge, for two days.

The DM's own people (new canon): **Peddler, Hermit, Drover, Sellsword, Minstrel, Stranger**,
named from the peoples of Eldmoor; place markers: **ruin, camp, shrine, cairn door,
watchtower**, named like "the lantern cairn of Mirefen" or "the drovers' camp of Thornvale".

### DM-made sites (issue #69, names checked in #919)
With the `create_site` lever the DM raises a new dungeon on open ground, in one of six themes (`src/data/sites.js`). The theme fixes how the place is named, the look of its mouth and the names of its chambers; the place word comes from the region's biome. All of it is generic fantasy vocabulary and none of it copies another world's proper nouns.

| Theme | Name pattern | Mouth, as first seen | Chambers (guard / trap / puzzle / shrine / treasure / boss) |
| --- | --- | --- | --- |
| Barrow | "the Sedgemere Barrow" | A low stone door in a grassed mound, its lintel cut with worn signs. | the Bone Passage, the Grave Niches, the Low Hall / the Sunken Floor, the Narrow Stair / the Door of Names / the Candle Alcove / the Grave-Goods Vault / the Barrow-Heart |
| Fortress | "Cindercrag Hold" | A palisade of sharpened stakes round a squat stone keep, smoke rising. An outlaw hold. | the Gatehouse, the Barracks, the Wall Walk / the Killing Yard, the Murder Holes / the Barred Postern / the Old Chapel / the Strongroom / the Great Hall |
| Temple | "the Temple of Murkholm" | Broken steps going down to a pillared door half buried in silt. | the Narthex, the Cloister, the Choir / the Flooded Aisle, the Fallen Nave / the Rune Door / the Lady Chapel / the Reliquary / the Sanctum |
| Mine | "the Flintrock Delvings" | A timbered adit in the hillside, rails running into the dark. | the Upper Gallery, the Ore Chute, the Long Seam / the Shaft, the Rotten Props / the Winch Room / the Miners' Shrine / the Tally Room / the Deep Seam |
| Den | "the Wyrmby Den" | A dark hollow under roots and boulders, the ground trodden bare and strewn with bones. | the Run, the Gnawing Hollow, the Litter Cave / the Sinkhole, the Loose Scree / the Choked Passage / the Old Spring / the Hoard of Bones / the Deep Den |
| Ruin | "the Ruins of Oakwick" | Roofless walls and a cellar stair, the stones scorched black. | the Broken Court, the Cellars, the Collapsed Hall / the Fallen Stair, the Sagging Gallery / the Sealed Study / the Household Shrine / the Hidden Strongroom / the Throne Room |

**Place words.** A site's name joins a first part and a second part by the region's biome, written to read like the zone names (Thornvale, Mirefen, Cinderpass, Hoarfell). A biome not listed uses the last row.
- Meadow (Thornvale): Thorn, Bramble, Oak, Hawk, Briar, Wold + hollow, ford, wick, dell, stead, ley.
- Fen (Mirefen): Sedge, Reed, Murk, Eel, Bitter, Silt + mere, holm, fen, marsh, water, pool.
- Ash (Cinderpass): Cinder, Ember, Slag, Soot, Char, Flint + crag, fell, gorge, scar, hearth, rock.
- Tundra (Hoarfell): Rime, Frost, Hoar, Snow, Tarn, Winter + fell, cairn, reach, howe, moor, tor.
- Other: Grey, Stone, Black, Old, Raven, Wyrm + moor, holt, stead, cairn, dale, by.

**Never paired.** Winterfell (a famous name), Sedgewater (a Stepping Lands region), Hoarfell (a real zone), and Soothearth, Slagcrag and Brambleley (they read badly). The generator also skips a join that doubles a letter (Wold + dell) and one that equals a region or town name. Reserved so a DM site never shadows canon: Greyreach, Lowmead, Wendmere (test fixture), and Rimeholt, Cairnwold, Cinderreach, Palereach (Stepping Lands). "Rimereach" and "Cinderrock" are legal but sit close to those; the DM should not raise both beside one company.

**Notes for the DM.** A barrow's boss is a never-lain-down dead thing, a fortress's an outlaw captain of the roads, a temple's a keeper turned from the altar, a mine's whatever dug the last seam, a den's its mother, a ruin's the last lord holding court. Barrows and temples draw their relic from the Crypt's epics, the rest from the region's own.

## Minds

Some heroes are played by a language model instead of the old rules of thumb. In Eldmoor that means nothing at all: there is no such thing as an AI-played hero, only heroes. They are born, swear oaths, hold grudges and die the same way as everyone else, once, for good. The UI marks them with an "AI-played" badge because the watcher may want to know; the world does not. A mind that falls silent (the relay is down) is written as a dim chronicle line, "<hero>'s thoughts go quiet", and the hero simply goes on as before. Minds speak in their faction's voice: Concord formal and dry, Warband blunt and short. They never mention models, prompts, players or games.

A hero played by an agent (one that chooses where to go and when, and keeps its own journal) is still just a hero in the world. It walks the same roads, rolls the same dice, sees only what its eyes reach and dies once like everyone else. The town does not know it is any different; only the watcher's "Agent" badge does. Its journal is the hero's own, written in the hero's voice.

## The Fellowship

One company of five is the story Eldmoor tells; everyone else is the world around them. A company swears in one town of one faction (the default one is the Fellowship) and keeps fixed places: a **Tank** (a warrior who stands where the blows land), a **Healer** (a priest) and three **DPS** (mages, hunters and rogues, one of each when the faction can spare them). The five lodge together in their hall town, muster at one gate and leave together; they still bleed, level and die by the same rules as everyone else. Hardcore binds them too: a fallen member stays fallen, the survivors carry the news home, and the empty place is offered to the living hero of that calling who knew them best, or to the next recruit.

Every member carries a **backstory** (family and home, how they came to arms, one defining day tied to the living world: a real elite, a real rival, a real place; a flaw or secret; what they want and fear; why they joined) with at least one tie to another member: a shared hamlet, an old debt, a rescue, a rivalry, kin or an oath. A **persona sheet** (voice, wants, fears, a quirk, a line they would never say, and how they see each companion) is drawn from the same facts. Both may be written once by a model through the relay; the watcher can rewrite any of it. Members keep a **memory**: a dozen recent lines in their own terms, a longer summary of what has faded, and their standing with each companion. The **campaign log** records each game-day as a session: jobs taken, scenes and rolls, people met, deaths and recruits, and the threads still open.

Names: a company is named in its faction's voice when it is founded. Concord names are sober and civic (The Patient Watch, The Lantern Wardens, The Covenant of Highgate, The Ledger of the Quiet Road); Warband names are short and brutal (The Broken Teeth, The Red Five, The Pit of Grimhold, Thrakash’s Scarred Five). Word lists live in `src/sim/company.js` (`NAME_PARTS`) and are original to Eldmoor, with one exception under review: the adjective `Grey` paired with `Company` yields "The Grey Company", the name of Aragorn's rangers in Tolkien, and must be replaced in the sim list (suggested: `Dun`). "Fellowship" is the in-world name of the default company of five ("company" is the generic word, and a Concord company may call itself a fellowship, a Warband one a pack). It is a generic English noun but is also the title of Tolkien's first volume; it is kept as the product term and should never be paired with a ring, a nine or a quest to destroy anything. Reviewed 2026-11-01.

### Archetypes (issue #295)

Six optional temperaments a company member's persona can take in place of a generated sheet (`src/data/archetypes.js`, applied by `applyArchetype` in `src/sim/persona.js`). Each fills only the voice, wants, fears, quirk, the line never said and a default stance, and records its id as the persona's `archetype`; class, bonds, oath, home and history are never touched. The names are generic fantasy roles.

- **Dour Veteran**: weary, buries friends and expects more; wants the young ones home alive.
- **Bright Idealist**: earnest, sure a road can be made safe; fears the work changes nothing.
- **Quiet Schemer**: soft-spoken, three moves ahead; every kind word has a second purpose.
- **Comic Coward**: afraid and honest about it, always still there.
- **Burning Zealot**: one cause, one answer; fears the quiet kind of doubt.
- **Plain Mercenary**: fights for coin, stays for the company, never says so.

### Camp and the night watch

When night falls (21:00 to 03:00) or the company is worn thin, and the whole company (or all but one) is out on the road, they make camp on open ground at least eleven tiles from any town and fourteen from Kragmaw's lair or the Sunken Crypt: a ring of stones, a small fire, a bedroll each. They sleep in turns of two hours each, one of them on **watch**, and an hour at a time the dark may send a visitor (a wandering foe of the region, or an enemy hero passing close). A watcher who hears it in time wakes the camp; one who nods off lets the visitor reach the fire. Camp heals everyone; a night camp breaks at first light once all are mended. Round the fire they tell stories, sing and sometimes quarrel. The camp songs and sayings are folk verse of the Thornvale roads, not named works: the lantern road, the seven bells and the broken oar, the river crossing that did not count. No new place is named.

## Memorials

Eldmoor remembers its dead where they fell. A hero who dies in the wild leaves a small **wayside stone** carved with their name and level, and the stones stay long after the grave-digger has cleared the common graves; the oldest are cleared first once there are sixty, but a Fellowship member's stone and a legend's are never taken. A hero who reaches **level 20**, or who falls at level 15 or higher, is given a **statue** in the square of their home town (three at most per town; a greater legend displaces the weakest) with a plaque of their name and level. When Kragmaw is slain the **lava ring of its lair cools to black rock** and a loot-cave opens at its heart, "Kragmaw's hoard", until the wyrm wakes. These are watcher-facing markers, not places heroes travel to. Code: `src/sim/memorials.js`, `src/render/memorials.js`.

## Campaign seeds

DM-only starting narratives, one per world map, in `docs/campaigns/` (`eldmoor.md`, `stepping.md`). The DM agent receives them as private notes when a new world begins; heroes never read them, and the DM reveals them only through play (narrate, npc_say, hooks, staged scenes, marks). Format is fixed: Premise, Threads, Characters, Plans, Secrets. Added 2026-11-01.

New names (townsfolk names are rolled per world and are not canon; these placed people are):
- **The Lantern Road**: the old road from Highgate and Grimhold to the crossroads, lined with lanternstones.
- **Ossian Vael, the Drowned King**: lit the lanternstones from a spark of Kragmaw's fire and drowned his court in the Sunken Crypt under Lich-Warden Vesk. Source of the Drowned King's Signet.
- **The Rookscar toll**: the Rookscar are the last road-wardens of the Drowned King; their Toll-Token is their pay-slip. Their reeve on the Mirefen road is **Black Tam Harrow** (Black Tam is an existing road-boss name).
- **Edrin Pask**: wagon merchant, carries Shrine Candle-Stubs.
- **Mother Ysmay**: the Causeway Hermit of Mirefen, counts a drowned king's causeway stones.
- **Old Vrogg**: Warband sellsword with a half-burnt oath-knife.
- **Hesper Wain**, Cairn-Keeper (Stepping Lands): last of the waymark keepers.
- **Sister Maud Orrin**: Concord pilgrim-priest walking the Stair.
- **The Pilgrim's Stair** (Stepping Lands): the line of waymark-cairns from Lowmark to Palereach.
- **The Dark Waymarks** (Stepping Lands): the thread of the waymark-cairns going dark in order, from Palereach back toward Lowmark. A **waymark-cairn** is a pilgrim's stone pile with a candle-stub at its base; a lit cairn marks one stage of the walk (see the seed's "The Cairns Are a Calendar"). Cairns facing the wrong way and wet stubs are the early signs.
- **Pilgrims With No Gate**, **Hollowfang's Season**, **The Door at the Hollow Cairn**, **Murkstead Salt, Cairnmoot Wool** and **The Ram-King's Toll** (Stepping Lands): the other thread titles of the Stepping seed. They use canon places and creatures only: Hollowfang, the Hollow Cairn (sealed, no dungeon run), the Greywater trade between Murkstead and Cairnmoot, and Brask Ironhorn's pass.
- **The Compact of Four Pages** (Stepping Lands): one page in each home town (Highgate debts, Cairnmoot the route, Grimhold the salt-song, Murkstead the names).
- Endings named in the Eldmoor seed: **the Kept Light**, **the Dark Road**, **the Unowned Flame**.

### The smith's temper (issue #13)

In any friendly town a smith will temper a worn piece of gear for gold alone: one item level higher each time, up to three
tempers a piece, never past the wearer's level plus two, dearer for finer metal and for each step. Epics cannot be
tempered: they grow with their bearer on their own. Gear does not wear in Eldmoor, so the smith mends nothing. A piece replaced by a better
one carries its tempering away with it. Scripted heroes visit the smith after the market when they have gold to spare;
agents use the `smith {item, do}` tool.
