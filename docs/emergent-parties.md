# Emergent parties (epic #402): design

Owner direction (2026-11-02): "Eventually I want them to start separated, then they may find each other and
group up and go on adventures or stay solo." And: "I want the agents to have as many tools as possible, to
make them be able to choose their adventure."

Hard rules that hold throughout: hardcore death; every decision of an agent-played hero is its agent's; the DM
serves the agent heroes first, then the world; in-game channels only. This is a design document, no code.

The word for the thing: a **company**. Today the game has exactly one company, the Fellowship, of exactly five.
After this epic a world has any number of companies of 1 to `PARTY.MAX` agent heroes each, and "the Fellowship"
is a name a company may carry, not a data structure.

## 0. What is fixed-five today (the map)

Read from `main` at 8ffbeb8. The assumptions, by file:

| Where | Fixed-five assumption |
| --- | --- |
| `sim/fellowship.js` | `S.fellowship` singleton; `SLOTS`/`SLOT_KEYS` (tank, healer, dps1-3) with class lists `DPS`, `HEALERS`; `fits(k,a)`, `checkSlots`, `autoPick`, `found(slots)`, `join(a,key)`, `leave`, `offerReplacement(key)`, `onDeath(a,key)`, `muster()` (one `p.fellow` party), `fellows()`, `fellowshipMembers()`, `isFellow`, `roleName`, `campaign()` log, `openThreads`, `chronicleFocus`, `F.hall` one town, `a.fellow`, `a.fellowRole`, `a.fellowFrom`, `F.letters[slot]` (notebook.js) |
| `sim/setup.js` | a setup is `{fac, slots:{tank..dps3}}`; `validateSetup` walks `SLOTS`; `pickSetup`, `applyMinds`, `planRunners` (one `fellowship` runner when all five share a mind); presets copy five slots; `resolveArchetype` keyed by slot |
| `sim/opening.js` | `opening()` founds one Fellowship at level 1 in one hall; `fellowshipStart` flag |
| `sim/council.js` | `F.props`, `voters(P)=fellows()-absent`, `leaderOfF()`, `propose` refuses non-fellows, `NEED_ALL` crypt/raid take "the whole Fellowship", `unitDraft` all-or-none for the one company, `cryptHold`/`raidReserve` reserve for it, `splitOff` costs bonds with every fellow, `followLead` |
| `sim/reach.js` | `outOfRange`, `together`, `makePlan`, `sendCourier` (fellows only), `absence()` clusters of fellows, `F.plans`, `F.post` |
| `sim/camp.js` | `S.fellowship.camp`, `CAMP.MIN_CAMP` 3, `leaderOfF()`, `campTick` needs the (near) whole company out together |
| `sim/table.js` | `tableOn()` needs `S.fellowship`; one `S.table`; `open()` lists `fellows()`; `present()` = fellows in range of the anchor; `lowest()`, `reflexFor` (`a.fellowRole==='tank'`), `tableTick` loops `fellows()`; `F.tableSeq/tableSeen/tableStats`; `PLAY` 'all' resolves "in slot order" (= `F.ids` order) |
| `sim/tableround.js` | size-free already (`foeSlot(L,f)`, initiative by Reflex) |
| `sim/crawl.js` | `crawlFits(g)` = a fellow in the group; `reflex` uses `a.fellowRole`; tally on `S.fellowship.crawl`; `S.fellowship.name` in lines |
| `sim/dungeon.js` / `boss.js` | `unitDraft(..,'crypt'|'raid')`, `yieldCrypt(F)`, `cryptReserved`, `raidReserve()` single company; `musterCrypt(..., S.fellowship.name)` |
| `sim/dm.js`, `dmfocus.js` | `focus()` one `{ids, town: the hall, zones, busy}`; `fellowHook(c,fo)` one hall board; `K.FLOOR` for the other boards; `FOCUS.RESERVE` one reserve; `tally/share` one share; `hallHooks/hallBoard` one hall |
| `sim/staged.js` | `whereOf('fellowship')`, `partyLvl()` of all fellows, `STAGE.PER_DAY` 3 / `RESERVE` 1 for one company, `nearFellow`, refusals name "the Fellowship" |
| `sim/dmagent.js`, `scripts/dm-agent.mjs` | `fellowshipNeeds()`, `fellowshipSig()` one signature, `fellowship_view`, `fellowNow`, `eventDue` on one signature, `DMA.PILE_HP` over `fellows()` |
| `sim/player.js`, `data/player-tools.js` | `propose/vote/lead_to/break_camp/send_courier/party_say` gated on `a.fellow`; `join_party` (6 tiles, level gap 3, party of 3, loners refuse, scripted target accepts at once); `leave_party` is `splitOff` for fellows; `status.fellowship` card; `rest {hours}` leader only; `earshot` (#398) reads `shoutHearers` = fellows or `partyMates` |
| `sim/notify.js`, `runlink.js`, `pace.js` | size-free; `pace.js hallBrief` reads the one hall |
| `sim/save.js` | `SAVE_VERSION` 6; `describeSave` sorts `F.slots` by `SLOT_ORDER` |
| `ui/frames.js`, `sheet.js`, `fellowship.js`, `controls.js`, `lifeview.js` | `fellowshipMembers()` five frames keyed 1-5, `before(slot)`, `fellowParty().leader` star; sheet columns = five; panel founds by slots (`fits`, `autoPick`); `vFel` Follow Fellowship; Chronicle "Fellowship only" filter |
| `scripts/fellowship.mjs`, `runners.mjs`, `play-host.js` | the runner takes every `heroes[].fellow` from `/play/health`; `kind:'fellowship'` runner key; `RELAY_MAX_RUNNERS` 6 = five + DM; `fellowshipPrompt` says "Four companions share your one road" |

Roughly 1,000 references to `fellow` across sim, scripts, ui and the checks (tablecheck 77, fellowship.js 73,
uismoke 40, dmcheck 40). Most are mechanical once the core helpers exist.

## 1. The party model

**Company** (`sim/company.js`, new; `fellowship.js` shrinks to a thin shim then goes):

```
S.companies: [{id, name, fac, hall, ids:[heroId in join order], founded, day, log, past, npcs, seq,
               props, propSeq, plans, post, camp, wait, cool, accept, letters, dmSeen, tableSeq, tableSeen,
               tableStats, crawl, dmLast, enrich, ai}]
a.company: companyId | undefined      (replaces a.fellow / a.fellowRole / a.fellowFrom)
S.parties[].company: companyId        (replaces p.fellow)
```

Rules:

- **Every agent-played hero is in exactly one company at all times.** A hero alone is a company of one (a
  *solo*). This is the single rule that makes the rest fall out: a solo has a campaign log, a hall, DM focus,
  Table scenes and a frame without special cases. `markPlayer(a,true)` on a hero with no company founds one
  (`foundCompany([a])`); `markPlayer(a,false)` on a solo dissolves it.
- **Size** 1 to `PARTY.MAX` (proposed 6; today's `join_party` cap of 3 stays for scripted parties). Several
  companies at once, of either faction; a company is single-faction (as `seekParty`, `join_party` and the
  Crypt/raid pools already require). Cross-faction grouping is an owner question (section 10).
- **Forming**: two solos who agree (`invite` + `accept`, section 2) become one company; the new company takes
  the inviter's id and log, the joiner's log is folded in as one `join` line each way. A solo who accepts into a
  company of 2+ joins it. **Merging** two companies of 2+ is a `merge` proposal in both (section 3).
- **Splitting** keeps today's two shapes: a *split* (`leave_party` without `for_good`, `splitOff`, `a.splitUntil`,
  a meeting plan, the member stays on the roster) and a *leave* (`for_good: yes`: the member becomes a solo
  company, bonds cost `COUNCIL.BOND_COST` with each former companion, the old company's log gets `leave`, the new
  solo's log starts with `found`). A company of 2 whose member leaves leaves a company of 1, never zero.
- **Dissolving**: a company ends only when its last living member dies and its seat is not refilled (section 7).
  `S.companiesPast` keeps the record as `S.fellowshipsPast` does.
- **Leader**: `leaderOf(C)` = the living member with the highest level, ties by total bond with the others, then
  id (today `leaderOfF`); a party's `p.leader` follows it. A solo leads itself, so every leader-only tool works
  for a solo without a special case.
- **Hall**: `C.hall` is the leader's home town at founding (today `homeOf(lead).name`); it moves when the leader
  changes home or the roster changes faction majority (never, by the single-faction rule). Members no longer get
  `a.town=F.hall` (today `join()` relodges them); they keep their own home and the hall is where the company's
  board is. Couriers are hired at any town gate (`sendCourier` already needs `a.state==='town'`).
- **Roles** stay as **labels, not slots**: `roleOf(cls)` -> `tank` (Warrior), `healer` (`HEALERS`), `dps` (the
  rest). They drive frame colour (`r-tank` etc.), the crawl and table reflexes (`a.fellowRole==='tank'` becomes
  `roleOf(a.cls)==='tank'`) and `ROLE_NAME` in persona text. Nothing refuses a company for its composition: three
  Mages may ride together, and the dice already price that (`pw` in `dungeon.js` adds 2.5 for a healer and 1.5
  for a Warrior; `CRAWL.GUARD_DRAW` needs someone to guard). The classic five is a setup preset, not a rule.
- **Scripted parties** (`sim/party.js`, 2-3 heroes, `seekParty`) stay as they are. A company's walking group is
  still a `S.parties` row (`p.company` set) so `partyTick`, `shareKill`, `followPt`, `rally` and `steerClear`
  work unchanged; `partyTick` keeps a company party across level gaps (today's `!p.fellow` check) and never
  disbands it on a death (the company tick does the bookkeeping).

Core helpers (all read-only, no RNG): `companyOf(a)`, `companies()` (living, id order), `members(C)`,
`mates(a)` (living members of a's company except a), `leaderOf(C)`, `isSolo(C)`, `roleOf(cls)`,
`campaign(C, kind, ...parts)`, `openThreads(C)`. Transitional shims during the slices: `fellows()` ->
`members(followed())`, `fellowParty()` -> the followed company's party, `S.fellowship` -> `followed()` where
`followed()` is the company the watcher follows (`S.followId`, default the first). They are deleted in the last
slice.

## 2. Meeting and grouping verbs (tools)

All in `data/player-tools.js` (the table) and `sim/player.js` (the game side). Rules: an agent hero only ever
acts for itself; what another hero learns of it arrives as a chat line or an event (in-game channels, #123);
nothing reveals a far hero's position, HP or mind. Ranges are the existing ones: `PK.JOIN` 6 tiles for a deal
struck face to face, `EAR.HEAR` 7 for `say`, `shoutRange` 12 for the company channel.

| Tool | Args | Does | Refuses when | Channel |
| --- | --- | --- | --- | --- |
| `invite` (new, act) | `hero_id` or `name`, `text?` (<=200) | Offers a place in your company (or to form one): `C.offers.push({id, from, to, until: +PARTY.OFFER_MIN 60, text})`. The invitee hears it as a `say` line and gets an urgent-2 event "X asks you to ride with them (accept N / decline N)". A **scripted** invitee answers at once by its traits: `tm(b,'social')`, level gap <=3, no party, not busy -> joins; else a declining line from `data/camp.js`-style tables (no RNG: a hash of ids). | Other faction; not within `PK.JOIN`; your company is at `PARTY.MAX`; invitee in `dungeon/raid/duel/ghost/camp`; an offer to them is already open; invitee leads a company of 2+ ("invite is for one; propose merge to join companies"); the Crypt or a raid is pending for you | `say` (the offer is said aloud: heroes in earshot hear it) |
| `accept` (new, act) | `offer_id` | Joins the inviter's company: `joinCompany(a, C)`; bonds `bondEvent('party')`; one `campaign('join')` line in the company log; both agents get the event; `remember` for all members. If you were a solo, your log folds in. | Offer expired or withdrawn; inviter dead, out of `PK.JOIN`, or company full now; you are in a company of 2+ (leave first, or merge); you are in a scene | event + chat ("X rides with us now") |
| `decline` (new, act) | `offer_id`, `text?` | Closes the offer; the inviter hears your line (or "X shakes their head"). | No such offer | `say` |
| `join_party` (existing) | `hero_id` | Becomes "ask to join": toward an **agent** hero it opens an offer from you to their leader (same table as `invite`, reversed); toward a **scripted** hero or party it works as today (6 tiles, gap 3, cap 3, loners refuse, at once). Keeps the name so older sessions still work. | As today, plus the invite refusals | `say` |
| `follow` (new, act) | `hero_id` or `name`, `hours?` (1-12, default until you give another order) | Walk at a hero's side without joining: `a.pq=[{kind:'follow', id, until}]`; `travel()` steers to `followPt`-like offset; stops on any `move_to/hunt/fight/rest`, when they go hidden (Crypt), enter a town you cannot (enemy), or die. The followed hero gets a soft event "X falls in behind you" and `look` lists "X walks with you". Not a party: no shared XP, no `party_say`, no votes. | Not in sight (`look` range); other faction outside town; you lead a company party of 2+ ("lead_to, or leave first") | event, `look` |
| `leave_party` (existing, +arg) | `where?`, `when_hours?`, `for_good?` ('yes') | Today's split (`splitOff`, `makeMeeting`) without `for_good`; with it `leaveCompany(a)`: a new solo company, bonds cost, `campaign('leave')`, the companions in range hear "X leaves the company" and the far ones learn it on rejoining (`AWAY.KINDS` gains `leave`). | A solo ("you ride alone already"); mid-scene; the Crypt group formed | `party_say` (the parting is said to those in range) |
| `propose kind:'expel'` (new kind) | `hero_id`, `details` | A vote of the present members except the target (the target hears it, may `say`, cannot vote); passes by majority, leader breaks ties; on pass `leaveCompany(target)` with bonds cost on both sides and `campaign('expel')`. | Company of 2 ("leave instead"); target out of shouting range; target in a scene; a vote already open | `party_say` + decision scene |
| `propose kind:'merge'` (new kind) | `company` (the other leader's name), `details` | Both companies vote (two proposals, one per company, linked by `P.pair`); both pass -> `mergeCompanies(A,B)` (the larger keeps its id and name, logs fold); either fails -> both fail. Leaders must be in shouting range of each other. | Sizes sum over `PARTY.MAX`; different factions; a vote open in either; either in a scene | `party_say` in each company; the other company hears "X's company offers to ride with us" through the leader's `say` |
| `companions` (new, read) | - | Your company as you know it: name; each member's name, class, role label and **how you know where they are**: "beside you" (in shout range now), else "last seen near <place> at <time>" from `a.seen[id]` (written each tick a companion is in range; a place name, never coordinates), the open meeting plan, couriers out, offers open to you. Folds in `earshot` (#398) so one call answers "who hears me, who is near, who is lost". | - | - (own knowledge) |
| `send_courier` (existing, widened) | `to`, `text` | Any **hero you know by name** (met: in `a.talked`/`a.seen`, or in your company), not only companions. Cost by distance from your gate to their last known place. | As today; "you have never met X" | courier event + chat line |
| `post_notice` (new, act) | `text` (<=120) | Pins a notice to your town board for `PARTY.NOTICE_DAYS` 2: "A Warrior seeks companions for the Greenmarch; ask for Kerin at the inn." `list_jobs` and `look` in that town list notices; a reader learns your name and town (`learnPlace`, `talked`). At most one notice per hero. | Not in town; a notice already up | board (read by anyone at that gate) |
| `list_jobs` / `talk` (existing, +rumours) | - | The innkeeper (`talk innkeeper`) and the gate line in `list_jobs` add **sightings**: `S.sightings[]` `{hero, town, at, bound: zoneName}` written when an agent hero passes a town gate (`town()` step 2) or sets out with `move_to` a region. "A Priest called Lorwyn passed through two days ago, bound for the Hollow." Only agent heroes leave sightings; scripted heroes do not, so `npm run sim` is unchanged. | - | townsfolk (`npc` line) |

Pacing (`sim/pace.js`, `scripts/pacing.mjs`): an open offer to you is a must-answer event (`urgent=2`) with a
60-game-minute window; the state header carries `offers:[{id, from, until}]` and `company:{name, size, leader,
with_you:[...], apart:[...]}` in place of `fellowship`. The turn prompts (`scripts/agent-player.mjs`,
`fellowship.mjs`) replace "Four companions share your one road" with the company card from `fellowCard` (which
becomes `companyCard(a)` in `persona.js`, size-free).

## 3. Table, council and crawl for any size

**Council** (`sim/council.js`): `F_()` -> `companyOf(a)`; `F.props` -> `C.props`; `voters(P)` = living members
of that company present when it was made (as today, `P.absent`); `leaderOfF()` -> `leaderOf(C)`. Quorum: the
votes of those present, majority of votes cast, the leader breaks a tie (a company of 2: the leader decides a
tie, which is every disagreement; that is the point of a leader). A **solo** has no one to ask: `propose` is
refused with "You ride alone: decide and act (take_adventure, lead_to is move_to for you)", except
`break_camp`, which a solo leader does with the leader tool anyway. `PROP_KINDS` gains `expel`, `merge`,
`invite` (optional: a member asks the company before inviting a stranger; a leader may `invite` without it).
`NEED_ALL` (crypt, raid) means the whole **company** together, so a company of 2 may answer a Crypt call with
three background heroes filling the group (today `unitDraft` already fills from `pool`).

**Reach** (`sim/reach.js`): every function takes the company: `together(members(C), leaderOf(C))`,
`absence(C)` clusters per company, `C.plans`, `C.post`. `witness` is per company. Two companies in range of each
other do not share a channel: `party_say` is your company's; `say` is for everyone in earshot. That is how
companies talk before they merge.

**Camp** (`sim/camp.js`): `CAMP.MIN_CAMP` becomes `Math.min(3, members(C).length)`: a solo makes a one-person
camp (a watch with no sleeper: it heals slower, `CAMP.SOLO_HEAL` .6 of `CAMP_HEAL`, and an ambush finds it
unroused half the time by the same Perception roll). `S.fellowship.camp` -> `C.camp`; two companies may camp at
once (two fires). `campTick` loops `companies()`.

**Table** (`sim/table.js`): `tableOn()` = any company exists and the switch is on. `S.table` stays **one scene
at a time** (the world pauses for one table). `open()` takes the company: `sc.company=C.id`, `ids` from
`members(C)` (and for `site/room/crawl` those in `CRYPT.group.mem`). `present()` = members of `sc.company` in
range of the anchor. `lowest()`, `reflexFor`, `fellows()` in `apply`/`outcome`/`nextRound` -> `members(C)`.
`PLAY` 'all' resolves "in slot order" = `C.ids` join order (deterministic for a seed). `tableTick` loops
`companies()` in id order and `S.playerHeroes` for triggers; when two moments are due in one tick the lower
company id opens and the other keeps its cooldown key unset so it opens next tick if still true. A **solo** gets
every scene kind: `rescue` (its own HP below `TABLE.RESCUE`), `elite`, `ambush`, `boss`, `check`, `choice`,
staged scenes; a one-member turn still rolls the foe's round (`foeSlot`) and offers strike/guard/potion/abilities/
parley/retreat, which is where a solo's hardcore drama lives. Everyone-at-once with one member is a single answer.
`decisionsWaiting()` and `bannerOf()` carry `company` so the runner-stop alert and the banner name whose table it is.

**Crawl and the draft** (`crawl.js`, `dungeon.js`, `boss.js`): `crawlFits(g)` = the group holds a member of any
company; the acting members at the table are the company members in `g.mem` (background fill-ins ride along as
today). `unitDraft(list,pool,n,kind)` takes the company of the first drafted agent hero in `top` and applies
all-or-none to **that** company; a second company in the same pool is left for the next muster
(`CRYPT.cd` 20-45 s). `cryptHold`/`cryptReserved`/`raidReserve` look across companies (the oldest open crypt
proposal holds the Crypt; the raid reserve is the first company with an open raid vote). `yieldCrypt(C)`.
Tally on `C.crawl`; the sim summary sums them.

## 4. The DM's "agent heroes first" when they are scattered

`sim/dmfocus.js`: `focus()` -> `focuses()`: one record per company, id order:
`{company:C, ids, town: CITY row of C.hall, zone, zones, x, y, field, busy, members, lastTouched: C.dmLast}`.
`focus()` remains as "the followed company" for the watcher only. `touches(e)` is true when any company is
touched and returns which (`touchesWhich(e) -> [companyId]`); `tally(e)` bumps `S.dmFocus.acts/fellow` as now
and `S.dmFocus.by[companyId]`, and sets `C.dmLast=S.gameMin`. `share()` is unchanged (any company counts), and
`fairness()` is new: `{spread: max-min of per-company acts today, starved: companies with no action for
FOCUS.STARVE_MIN (360) while in the field}`.

**Reserved shares** (`levers.js` line ~163, `reserveOf`): the reserve of each lever's `perDay` stays
`FOCUS.RESERVE` .34 of the limit for *any* company; a pull that touches a company that already had an action in
the last `FOCUS.FAIR_MIN` 240 minutes while another company is starved is refused with "kept for <starved company>
first" when only the reserve is left. Staged scenes: `STAGE.PER_DAY` becomes `2 + companies()` (3 for one company,
as today), `STAGE.RESERVE` becomes `companies()` with one kept per company; `whereOf` accepts `near: "company:<id>"`,
a company name, a member; `partyLvl()` is per company (the staged foe's level is bounded by **that** company,
`STAGE.LVL_UP` above its average, so a solo at level 4 never meets a level-9 elite staged for the five next door);
`PILE_HP` is checked against the company the scene is near. `fellowNow` in `scripts/dm-agent.mjs` and
`fellowshipNeeds()` in `dmagent.js` become `companies_needs: [...]` ordered **neediest first**: a pending scene or
vote, then hurt members in the field, then longest since `dmLast`, then size (a solo is the most fragile, hardcore);
`fellowship_change` becomes one signature per company joined with `|`, and `eventDue` fires on any change (still
`EVENT_MAX` 3 a day, `EVENT_GAP` 120). The standing orders say: "Each company in turn, the one longest without you
first; a solo is one bad roll from the graveyard, so a solo's road gets a hook or a rumour before the five get a
third."

**Hall boards per home town** (`dm.js`): `fellowHook(c,fo)` runs for every town that is some company's hall
(`focuses().filter(f=>f.town===c)`), one ff job per company on that board (two companies in Highgate: two jobs,
`h.company` set so `hallHooks` shows each theirs); `K.FLOOR` 1 applies to boards that are nobody's hall;
`ffOpen(c, fo)` and `fellowBounty(a,c,z)` take the company. `fits()` (dm.js ~318): an ff job "fits the whole
company" whatever its size, and a template whose `size[0]` exceeds the company gets fill-ins offered at the gate
("the captain sends two of his own") only for `T.size[0]<=3`; bigger jobs are not posted for a solo. `pace.js
hallBrief(a)` reads the hero's own company's hall. `dmagent.js fellowship_view` -> `companies_view`.

## 5. New World setup: start apart

`sim/setup.js`: the setup becomes

```
{v:2, world, seed, mode:'together'|'apart', name?,
 heroes:[{cls, name?, race?, fac, mind, profs?, archetype?, start?:{town?:name|'home', region?:name}}],   // 1..SETUP.MAX (5)
 dm:{mode, provider?, model?}}
```

`mode:'together'` founds one company of all heroes in one hall (today's behaviour; all `fac` equal, `start`
ignored); `'apart'` founds one solo company per hero at its `start.town` (default: its people's home town,
`homeOf`), optionally seasoned to its `start.region`'s band low (`season(a, band[0])`, `opening.js`), else level 1
in town. `validateSetup`: 1-5 heroes, each a legal class for its faction, names unique, `together` needs one
faction, `apart` allows both. `cleanSetup` migrates a v1 setup (`slots` -> `heroes` in `SLOT_KEYS` order,
`mode:'together'`) so the viewer's last setup and the URL still load. `resolveArchetype(setup, i)` by index.
`planRunners`: one `company` runner per company whose members share one mind, else hero runners (today's rule per
company); plus the DM. `applyMinds` loops `heroes`.

Presets (`PRESETS`): `classic` (today: Warrior, Priest, Mage, Hunter, Rogue, together, one faction),
`apart` (the same five, one per home town of the faction, level 1, `mode:'apart'`), `two-roads` (a Concord pair
and a Warband trio apart), `solo` (one hero), `local`/`claude`/`haiku`/`last` keep setting minds. The setup page
(`ui/setup.js`) gets a Together/Apart switch, a hero count 1-5, and per hero a start town picker filled from
`CITY` of its faction; `ROLE_ORDER` goes, cards are indexed. `opening()`: `found(pick)` -> `foundCompany(ids,
{name, hall})` per group; the balance flag `ELDMOOR_FELLOWSHIP=0` keeps meaning "no agent heroes at all".

## 6. UI

`ui-designer` owns this; the sim exposes only `companies()`, `members(C)`, `leaderOf(C)`, `followed()`.

- **Frames** (`ui/frames.js`): one strip row per company, the followed company first, each frame tinted by
  `roleOf(cls)`; solos share one "Alone" row. Keys 1-9 select frames in display order (`slotNo` -> index).
  `before(slot)` -> `C.past` filtered by class. Empty frames go away (no slots), replaced by a small "+" on the
  company row when the company is under `PARTY.MAX` (tooltip: who could join, from `S.sightings`).
- **Follow view** (`ui/controls.js`): "Follow Fellowship" becomes "Follow <company>", a cycle button through
  `companies()` (click again for the next); `fellowFrame()` frames the followed company's visible members;
  `S.followId` is saved. A solo is a one-member frame.
- **Sheet** (`ui/sheet.js`): columns = the followed company's members (1-6); the title is `C.name`.
- **Companies panel** (today's Fellowship panel, `ui/fellowship.js`): a tab per company plus "All"; per tab the
  roster, campaign log, open threads, hall board (`hallBoard(C)`), minds and runner controls; founding by slots goes
  (companies form in game); the owner keeps "Form one for me" as a setup-time action only. Memory tab per hero as
  now. Chronicle filter "Fellowship only" -> "Companies only" (`chronicleFocus` over all agent heroes).
- **Table banner** (`ui/table.js`): names the company ("The Dun Lantern at the table").
- **Chat tab**: a shout shows its company name when more than one exists ("Kerin shouts (Dun Lantern): ...").
- **Minds panel / runners** (`ui/agents.js`, `runners.js`): "Start all five" -> "Start <company>"; a solo's
  runner is a hero runner.

## 7. Save migration and replacements

`SAVE_VERSION` 6 -> 7, `MIGRATIONS[6]` in `sim/save.js`:

- `snap.fellowship` (if any) -> `snap.companies=[C]` with `C.ids` in `SLOT_ORDER` of `slots`, `C.hall`, `C.log`,
  `C.past` (slot -> `cls`), `C.props/plans/post/camp/wait/cool/accept/letters/dmSeen/tableSeq/tableSeen/
  tableStats/crawl` copied, `C.minds` dropped (always agents); `snap.fellowshipsPast` -> `companiesPast`.
- Every hero with `a.fellow` gets `a.company=C.id`; `a.fellow`, `a.fellowRole`, `a.fellowFrom` are deleted (the
  hero keeps `a.town` as it stands; the relodging is not undone). Every party with `p.fellow` gets `p.company`.
- Agent heroes with `a.player` and no company become solo companies (`foundCompany([a])`, no log line).
- `S.followId = C.id`. `describeSave` lists `companies[].members` for the title screen.
- `S.table` mid-scene gets `sc.company=C.id`; `S.staged` records keep `near.hero`.
- `ensureCampaign()` unchanged. `savecheck` adds a v6 fixture with a Fellowship, a split member and a mid-scene
  table, restored and hashed.

**Replacement when a hero dies** (hard rule: "a fresh level-1 recruit of the same class and guild replaces
them"): `onDeath(a)` in `company.js` writes `C.past`, `campaign('death')`, the memories and reflection moments as
today, then **the seat is refilled by a fresh recruit of the same class, agent-played, as a new solo company in its
home town** (`recruit(fac, cls)` + `foundCompany`), carrying the fallen one's runner settings (`logs/agents/<id>.json`
is per hero id; the relay's `watchWorld` sees a new id and the supervisor restarts the seat as it does on exit 75).
The company that lost a member is **not** topped up by the DM; it may `invite` the recruit, anyone else, or ride on
smaller. The fallen member's **letter** (`C.letters[]`: `{from, cls, note}`) is handed to the next hero who joins
that company of the same class, else to the next joiner after `PARTY.LETTER_DAYS` 3. `offerReplacement(key)` and
`SEED_BEHIND` go (seeding a replacement to the company's level was a fixed-five comfort; the owner may want it
back, section 10). When the last member of a company dies the company closes (`companiesPast`) and the recruit
starts its own.

## 8. Determinism and balance risks; checks

Determinism:

- Iterate companies by id, members by `C.ids` (join order), proposals by id; never by `Map` insertion of live
  objects. `S.table` single; tie-break two due scenes by company id.
- No RNG in any new tool path: scripted invitees answer by a hash of ids (`hash(a.id,b.id,...)`), as `locals.js`
  does; sightings and notices are plain data.
- The seeded no-Fellowship world (`ELDMOOR_FELLOWSHIP=0`) must hash the same before and after every slice
  (`node scripts/professioncheck.mjs --hash`, `CRAWL_BASELINE_HASH`). The seeded **default** world keeps its hash
  through slices 1-4 (pure refactors, `mode:'together'` default). It changes only when the default start changes
  (owner decision), and then the fixtures are re-baselined in that one PR.
- `npm run sim -- 60` and `-- 120` before and after each slice; report deaths, levels, crypt and Kragmaw.

Balance risks:

- **Solos die.** A level-1 solo with no healer, hunting alone, is the hardcore story the owner asked for, but the
  first week will show it: expect 2-3x the Fellowship's death rate per agent hero. Mitigations already in the
  design: the solo `rescue` scene, the solo camp, `companies_needs` putting solos first, the setup's `start.region`
  seasoning. Measure: deaths per agent hero per game day, by company size, in `behavior.js` (`world.jsonl` gains
  `companies:[{id, size, deaths}]`).
- **More Table pauses.** Five solos can raise scene count 3-5x; every scene pauses the world at 1x. Mitigations:
  the one-scene queue, `COOL` per company, and the owner question on pausing only for the followed company.
- **Runner seats and cost.** Five hero runners plus the DM is six seats (`RELAY_MAX_RUNNERS` 6, unchanged); five
  Claude solos take 5x the turns of one Fellowship runner between scenes (each paces itself). Keep `SETUP.MAX` 5.
- **DM starvation.** Levers at `perDay` were sized for one company; the fairness refusal and the per-company
  staged reserve spread them, but the DM agent will hit limits sooner. `dmcheck` asserts share >= 60% as now and
  adds "no company starved over 150 game hours".
- **Scripted world drift.** `seekParty`, `partyTick`, the Crypt pool and the raid pool must not see companies as
  anything but parties they already handle (`p.company` where `p.fellow` was).

Checks to add or update (CI groups run sequentially, see `check_fixtures` memory):

- **`npm run companycheck`** (new, `scripts/companycheck.mjs`): seeded; two solos founded apart in two towns;
  sightings and a courier by name; `invite` refused out of range, accepted in range; a company of 2 proposes
  `merge` with a third solo (one-sided accept); `expel` with the target speaking but not voting; `leave_party
  for_good`; a solo `rescue` scene with the foe's round; two scenes due at once open in id order; a solo camp and
  its ambush; a death refilled as a solo recruit with the letter rule; save mid-everything and restore; the
  seeded no-company hash unchanged; `mode:'together'` default world hash unchanged against main.
- `tablecheck`: scenes keyed by company; a company of 2 in everyone-at-once; a solo decision refusal.
- `crawlcheck`: a company of 3 plus two fill-ins; only the three act at the table.
- `dmcheck`: `companies_needs` order, hall jobs on two boards, staged `near:"company:2"`, the fairness refusal,
  per-company `STAGE.LVL_UP`.
- `setupcheck`/`setupsmoke`: v1 setup migration, `apart` preset, `planRunners` per company, start towns.
- `savecheck`: the v6 fixture above. `channelcheck`: `companions` never carries a far member's position or HP;
  an `invite` text reaches only earshot; notices carry only the text. `uismoke`: two company rows, follow cycle,
  the sheet with 2 columns. `localcheck`/`runnercheck`: `kind:'company'` runner, a solo on a hero runner.
- `balance-tester` report: 10-run batch of `npm run sim -- 120` with `apart` and `together` presets.

## 9. Slicing (8 PRs)

| # | PR (branch) | Owner | Files | Depends on | Parallel with |
| --- | --- | --- | --- | --- | --- |
| 1 | `ai/company-model`: `sim/company.js` (data, `foundCompany/joinCompany/leaveCompany/mergeCompanies/onDeath`, helpers, `roleOf`), `fellowship.js` becomes shims over it, `save.js` v7 migration + `describeSave`, `state.js` `S.companies/S.followId`, `party.js` `p.company`, `notebook.js` letters. Default world hash unchanged; `savecheck` fixture. | ai-designer | `sim/company.js`, `fellowship.js`, `save.js`, `state.js`, `party.js`, `notebook.js`, `scripts/savecheck.mjs` | - | - |
| 2 | `brain/council-any-size`: council, reach, camp per company; solo refusals; `expel`/`merge` kinds; `CAMP.MIN_CAMP` rule. `campcheck`, `tablecheck` votes. | brain-builder | `council.js`, `reach.js`, `camp.js`, `scripts/campcheck.mjs` | 1 | 3, 5, 6, 7 |
| 3 | `brain/table-any-size`: table per company and solo scenes, the one-scene queue, crawl and `unitDraft` per company, `cryptHold`/`raidReserve` across companies. `tablecheck`, `crawlcheck`. | brain-builder | `table.js`, `tableround.js`, `crawl.js`, `dungeon.js`, `boss.js`, checks | 1 | 2, 5, 6, 7 |
| 4 | `ai/grouping-tools`: `invite/accept/decline`, `join_party` semantics, `follow`, `leave_party for_good`, `companions`, `post_notice`, sightings, courier by name; pace header `company`/`offers`; prompts. `companycheck` (first half), `channelcheck`, `playcheck`. | ai-designer (tools), brain-builder (prompts in `scripts/`) | `player.js`, `data/player-tools.js`, `pace.js`, `reach.js`, `locals.js`, `scripts/pacing.mjs`, `agent-player.mjs`, checks | 1, 2 | 3, 5, 6, 7 |
| 5 | `ai/dm-companies-first`: `focuses()`, fairness, hall boards per hall, staged per company, `companies_needs`, DM standing orders. `dmcheck`. | ai-designer (`dm.js`, `dmfocus.js`, `staged.js`, `levers.js` one line), brain-builder (`dmagent.js`, `scripts/dm-agent.mjs`) | as named | 1 | 2, 3, 4, 6, 7 |
| 6 | `ai/setup-start-apart`: setup v2, presets, `opening()` per company, `planRunners`; setup page switch and start towns. `setupcheck`, `setupsmoke`. | ai-designer (`sim/setup.js`, `opening.js`), ui-designer (`ui/setup.js`) | as named | 1 | 2, 3, 4, 5, 7 |
| 7 | `ui/companies`: frames per company, follow cycle, sheet, Companies panel, chronicle filter, banner and chat names, runner buttons. `uismoke`. | ui-designer | `ui/frames.js`, `sheet.js`, `fellowship.js`, `controls.js`, `table.js`, `chatpanel.js`, `agents.js`, `runners.js`, `lifeview.js`, `layout.js` | 1 | 2-6 |
| 8 | `brain/company-runners`: `scripts/fellowship.mjs` -> company runner (`--company <id|name>`, members from `heroes[].company`), `runners.mjs` kind `company`, `/play/health` `company` field, seat restart on a solo recruit; shims deleted (`fellows()`, `S.fellowship`, `a.fellow`); CLAUDE.md, `docs/LORE.md` company name tables, memories. `companycheck` (second half), `localcheck`, `runnercheck`, `behaviorcheck`. | brain-builder, lore-keeper (names), balance-tester (report) | `scripts/*.mjs`, `sim/player-host.js`, `behavior.js`, docs | 1-7 | - |

Order: 1 alone on `main` first (it renames shared fields; nothing else may touch `fellowship.js` meanwhile).
Then 2, 3, 5, 6, 7 in parallel worktrees (disjoint files; 2 and 4 both touch `reach.js`, so 4 waits for 2).
Then 4. Then 8 closes the epic. Every PR pastes `npm run sim` and the seeded hash line; 1, 3, 4 and 6 add
`npm run sim -- 120`.

## 10. Open questions for the owner

1. **Cap.** `PARTY.MAX` 6? (Five was the Fellowship; six lets a solo join the five. Eight makes the Table slow.)
2. **Factions.** Keep companies single-faction (as every party and pool is today), or may a Concord hero ride
   with a Warband one? Mixed companies would need the duel/aggro rules (`pvp.js findMob`, `nearestFoe`) to treat
   companions as friends, and the enemy-town rules to let them in.
3. **Default start.** Should a New World default to `apart` (the owner's direction) or stay `together` (keeps every
   seeded hash and today's checks until the owner flips it)? This doc assumes `together` stays default through the
   slices and `apart` becomes default in a last, separate PR.
4. **Pausing.** At 1x, pause the world for every company's Table scene (fair, but five solos pause often), or only
   for the followed company's, the others resolving in rounds without the pause as 3x/8x reflex scenes do today?
5. **Replacement.** A fallen hero's recruit starts as a level-1 solo in its home town (this doc), or the DM offers
   the empty place to the company and seeds it 2 levels behind as today (`offerReplacement`, `SEED_BEHIND`)? The
   first is more emergent and more lethal.
6. **Seats and cost.** Five hero runners each pacing itself is roughly 5x the between-scene turns of one Fellowship
   runner. Keep `SETUP.MAX` 5 agent heroes, or allow more with local models only?
7. **Scripted companions.** May an agent hero invite a scripted hero into its company (it would be an agent-led
   company with a reflex-played member; today `join_party` allows parties with scripted heroes)? Or are companies
   agents-only, and scripted heroes join only as `S.parties` fill-ins?
8. **Jobs for one.** Should the scripted DM post board jobs sized for a solo (`T.size[0]` 1), or does a solo find
   its adventures through rumours, bounties and staged scenes only?
9. **The name.** "Company" (this doc), "band", "fellowship" kept as the generic word? `docs/LORE.md` wants one word
   for the Chronicle ("The Dun Lantern" is a company; "fellowship" is what a Concord company calls itself, "pack" a
   Warband one, from `NAME_PARTS`).
10. **Follow range.** `follow` works by sight (about 12 tiles). Should a follower who loses sight keep walking to
    the last seen point, or stop and say so (a "lost them" event)?
