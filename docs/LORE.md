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
- Concord: **<SV> Silver Vow**, **<DR> Dawnriders**
- Warband: **<BF> Bloodfang**, **<AF> Ashen Fist**

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

## Zones
| Zone | Levels | Description |
| --- | --- | --- |
| Thornvale | 1-5 | Green woods and meadows between the capitals and the river. |
| Mirefen | 6-10 | Swamps and mud flats east of the river. Contested; most PvP happens here. |
| Cinderpass | 11-15 | Volcanic rock and peaks in the east. |
| Hoarfell | 16+ | Wind-scoured snowfields and frozen tarns north of the fen and the pass. |

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
- **Kragmaw's Lair**: lava ring in eastern Cinderpass. World boss **Kragmaw the Cinder Wyrm**, level 18, raided by 4-6 heroes of level 12+.

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
