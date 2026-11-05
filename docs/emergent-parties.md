# Emergent parties (epic #402): design

Owner direction (2026-11-02): "Eventually I want them to start separated, then they may find each other and
group up and go on adventures or stay solo." And: "I want the agents to have as many tools as possible, to
make them be able to choose their adventure." Owner review of this doc (2026-11-03): ten decisions plus two
additions, recorded in section 13 and applied throughout.

Hard rules that hold throughout: hardcore death; every decision of an agent-played hero is its agent's; the DM
serves the agent heroes first, then the world; in-game channels only. This is a design document, no code.

The word for the thing: a **company** (owner decision 9). Today the game has exactly one company, the
Fellowship, of exactly five. After this epic a world has any number of companies, each of 1 to `PARTY.MAX` (8)
heroes, of whom at most `PARTY.MINDS` (5) are agent minds and the rest scripted companions. "Fellowship" (a
Concord company's word) and "pack" (a Warband one's) stay as names a company may carry (`NAME_PARTS` in
`fellowship.js`), not a data structure. Docs and the CLAUDE.md hard rules get one rewrite from "the
Fellowship" to "the company/companies" wherever they mean the generic thing (slice 12).

**Together stays the default start, permanently** (owner decision 3). A New World still founds one company of
five in one hall. "Apart" is a setup option with presets. Discovery comes from the verbs (invite, leave,
follow), from scripted companions and from the DM treating a split-off member as a thread, not from changing
the default.

## 0. What is fixed-five today (the map)

Read from `main` at 7467354. The assumptions, by file:

| Where | Fixed-five assumption |
| --- | --- |
| `sim/fellowship.js` | `S.fellowship` singleton; `SLOTS`/`SLOT_KEYS` (tank, healer, dps1-3) with class lists `DPS`, `HEALERS`; `fits(k,a)`, `checkSlots`, `autoPick`, `found(slots)`, `join(a,key)`, `leave`, `offerReplacement(key)`, `recruit(fac,cls)` with `SEED_BEHIND` 2 under `fellows()`' lowest, `onDeath(a,key)`, `muster()` (one `p.fellow` party), `fellows()`, `fellowshipMembers()`, `isFellow`, `roleName`, `campaign()` log, `openThreads`, `chronicleFocus`, `NAME_PARTS`/`fellowshipName`, `F.hall` one town (`join` relodges `a.town=F.hall`), `a.fellow`, `a.fellowRole`, `a.fellowFrom`, `F.letters[slot]` (notebook.js) |
| `sim/setup.js` | a setup is `{fac, slots:{tank..dps3}}`; `validateSetup` walks `SLOTS`; `pickSetup`, `applyMinds`, `planRunners` (one `fellowship` runner when all five share a mind); presets copy five slots; `resolveArchetype` keyed by slot |
| `sim/opening.js` | `opening()` founds one Fellowship at level 1 in one hall; `fellowshipStart` flag |
| `sim/council.js` | `F.props`, `voters(P)=fellows()-absent`, `leaderOfF()`, `propose` refuses non-fellows, `NEED_ALL` crypt/raid take "the whole Fellowship", `unitDraft` all-or-none for the one company, `cryptHold`/`raidReserve` reserve for it, `splitOff` costs bonds with every fellow, `followLead`, `shoutHearers` (fellows or `partyMates`) |
| `sim/reach.js` | `outOfRange`, `together`, `makePlan`, `sendCourier` (fellows only), `absence()` clusters of fellows, `F.plans`, `F.post` |
| `sim/earshot.js` | `folkWithin` and the "companion" / "(send_courier)" wording key on `a.fellow` |
| `sim/camp.js` | `S.fellowship.camp`, `CAMP.MIN_CAMP` 3, `leaderOfF()`, `campTick` needs the (near) whole company out together |
| `sim/table.js` | `tableOn()` needs `S.fellowship`; one `S.table`; `step()` pauses for it at 1x; `open()` lists `fellows()`; `present()` = fellows in range of the anchor; `lowest()`, `reflexFor` (`a.fellowRole==='tank'`), `tableTick` loops `fellows()`; `F.tableSeq/tableSeen/tableStats`; `PLAY` 'all' resolves "in slot order" (= `F.ids` order); `TABLE.drop` asks the host for 1x on any Fellowship decision |
| `sim/tableround.js` | size-free already (`foeSlot(L,f)`, initiative by Reflex) |
| `sim/crawl.js` | `crawlFits(g)` = a fellow in the group; `reflex` uses `a.fellowRole`; room foes are fixed `n` per room (sized for five); tally on `S.fellowship.crawl`; `S.fellowship.name` in lines |
| `sim/dungeon.js` / `boss.js` | muster pools filter `a.lvl>=CRYPT_LVL` / `RAID_LVL` (14); `unitDraft(..,'crypt'|'raid')`, `yieldCrypt(F)`, `cryptReserved`, `raidReserve()` single company; `musterCrypt(..., S.fellowship.name)` |
| `sim/dm.js`, `dmfocus.js` | `focus()` one `{ids, town: the hall, zones, busy}`; `fellowHook(c,fo)` one hall board; `K.FLOOR` for the other boards; no job sized below `T.size[0]` 2-3; `FOCUS.RESERVE` one reserve; `tally/share` one share; `hallHooks/hallBoard` one hall |
| `sim/staged.js` | `whereOf('fellowship')`, `partyLvl()` of all fellows, `STAGE.PER_DAY` 3 / `RESERVE` 1 for one company, `nearFellow`, elite/ambush pack sized for five, refusals name "the Fellowship" |
| `sim/dmagent.js`, `scripts/dm-agent.mjs` | `fellowshipNeeds()`, `fellowshipSig()` one signature, `fellowship_view`, `fellowNow`, `eventDue` on one signature, `DMA.PILE_HP` over `fellows()` |
| `sim/player.js`, `data/player-tools.js` | `propose/vote/lead_to/break_camp/send_courier/party_say` gated on `a.fellow`; `join_party` (6 tiles, level gap 3, party of 3, loners refuse, scripted target accepts at once); `leave_party` is `splitOff` for fellows; `status.fellowship` card; `rest {hours}` leader only; autopilot (`a.playIdle`) follows the party but has no follow-a-stranger mode |
| `sim/persona.js` | `fellowCard`, `roleOf` from `a.fellowRole`, `refreshStances(a, F.ids)`, snapshots name `fellowship` |
| `sim/lore.js` | threat reads exist for creatures (`threatText`, `RANKS`) and danger notes for places (`placeWarn`), but no read of a dungeon's stair |
| `sim/notify.js`, `runlink.js`, `pace.js`, `questlog.js` | size-free; `pace.js hallBrief` reads the one hall |
| `sim/save.js` | `SAVE_VERSION` 6; `describeSave` sorts `F.slots` by `SLOT_ORDER` |
| `render/dungeonview.js` | reads `S.fellowship.crawl` for the crawl tally |
| `ui/frames.js`, `sheet.js`, `fellowship.js`, `controls.js`, `lifeview.js`, `table.js` | `fellowshipMembers()` five frames keyed 1-5, `before(slot)`, `fellowParty().leader` star; sheet columns = five; panel founds by slots (`fits`, `autoPick`); `vFel` Follow Fellowship; Chronicle "Fellowship only" filter; one Table banner |
| `scripts/fellowship.mjs`, `runners.mjs`, `play-host.js` | the runner takes every `heroes[].fellow` from `/play/health`; `kind:'fellowship'` runner key; `MAX_RUNNERS` 6 = `SEATS` (five + DM); `fellowshipPrompt` says "Four companions share your one road" |

Roughly 1,000 references to `fellow` across sim, scripts, ui and the checks (tablecheck 77, fellowship.js 73,
uismoke 40, dmcheck 40). Most are mechanical once the core helpers exist.

## 1. The company model

**Company** (`sim/company.js`, new; `fellowship.js` shrinks to a thin shim, then goes):

```
S.companies: [{id, name, fac, hall, ids:[heroId in join order], founded, day, log, past, npcs, seq,
               props, propSeq, plans, post, camp, wait, cool, accept, letters, arrivals, dmSeen, tableSeq,
               tableSeen, tableStats, crawl, dmLast, enrich, ai}]
a.company: companyId | undefined      (replaces a.fellow / a.fellowRole / a.fellowFrom)
a.companion: companyId | undefined    (a scripted companion; see section 3)
S.parties[].company: companyId        (replaces p.fellow)
PARTY = {MAX: 8, MINDS: 5, OFFER_MIN: 60, NOTICE_DAYS: 2, LETTER_DAYS: 3}
```

Rules:

- **Every agent-played hero is in exactly one company at all times.** A hero alone is a company of one (a
  *solo*). This is the single rule that makes the rest fall out: a solo has a campaign log, a hall, DM focus,
  Table scenes and a frame without special cases. `markPlayer(a,true)` on a hero with no company founds one
  (`foundCompany([a])`); `markPlayer(a,false)` on a solo dissolves it.
- **Two caps** (owner decision 1): a company holds up to `PARTY.MAX` **8 heroes**, of whom at most
  `PARTY.MINDS` **5 are agent minds**. The slots above five minds can only be filled by scripted companions
  (section 3). Pacing and cost follow the **mind** count (runners, turns, seats); the dice follow the **hero**
  count: crawl room foes and staged elite/ambush packs scale with it (`scaleFoes(n, heroes) =
  max(1, round(n*heroes/5))`, so a company of five meets exactly today's numbers). Today's `join_party` cap of 3
  stays for scripted parties.
- **Single-faction** (owner decision 2): every member and companion is of the company's `fac`, as `seekParty`,
  `join_party` and the Crypt/raid pools already require. Mixed companies are a later epic with their own
  consequences (enemy towns refuse them, their guilds treat them as deserters), not a flag here.
- **Forming**: two solos who agree (`invite` + `accept`, section 2) become one company; the new company takes
  the inviter's id and log, the joiner's log is folded in as one `join` line each way. A solo who accepts into a
  company of 2+ joins it. **Merging** two companies of 2+ is a `merge` proposal in both (section 4), refused when
  the sum passes either cap.
- **Splitting** keeps today's two shapes: a *split* (`leave_party` without `for_good`, `splitOff`, `a.splitUntil`,
  a meeting plan, the member stays on the roster) and a *leave* (`for_good: yes`: the member becomes a solo
  company, bonds cost `COUNCIL.BOND_COST` with each former companion, the old company's log gets `leave`, the new
  solo's log starts with `found`). A company of 2 whose member leaves leaves a company of 1, never zero. The DM
  treats a member who splits or leaves as a thread of its own (section 6).
- **Dissolving**: a company of agent heroes is refilled on a death (section 8), so it ends only when its owner
  turns its heroes out of agent play (`markPlayer(a,false)` on its last member) or merges away.
  `S.companiesPast` keeps the record as `S.fellowshipsPast` does. Scripted companions leave on dissolution.
- **Leader**: `leaderOf(C)` = the living **agent** member with the highest level, ties by total bond with the
  others, then id (today `leaderOfF`); a scripted companion never leads. A party's `p.leader` follows it. A solo
  leads itself, so every leader-only tool works for a solo without a special case.
- **Hall**: `C.hall` is the leader's home town at founding (today `homeOf(lead).name`). Members no longer get
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

Core helpers (all read-only, no RNG): `companyOf(a)`, `companies()` (living, id order), `members(C)` (agent
members and companions, `C.ids` order), `minds(C)` (agent members only), `mates(a)`, `leaderOf(C)`,
`isSolo(C)` (one hero), `roleOf(cls)`, `campaign(C, kind, ...parts)`, `openThreads(C)`, `followed()` (the
company the watcher follows, `S.followId`, default the first). Transitional shims during the slices:
`fellows()` -> `members(followed())`, `fellowParty()` -> the followed company's party, `S.fellowship` ->
`followed()`. They are deleted in slice 12.

## 2. Meeting and grouping verbs (tools)

All in `data/player-tools.js` (the table) and `sim/player.js` (the game side). Rules: an agent hero only ever
acts for itself; what another hero learns of it arrives as a chat line or an event (in-game channels, #123);
nothing reveals a far hero's position, HP or mind. Ranges are the existing ones: `PK.JOIN` 6 tiles for a deal
struck face to face, `EAR.HEAR` 7 for `say`, `shoutRange` 12 for the company channel.

| Tool | Args | Does | Refuses when | Channel |
| --- | --- | --- | --- | --- |
| `invite` (new, act) | `hero_id` or `name`, `text?` (<=200) | Offers a place in your company (or to form one): `C.offers.push({id, from, to, until: +PARTY.OFFER_MIN, text})`. An **agent** invitee hears it as a `say` line and gets an urgent-2 event "X asks you to ride with them (accept N / decline N)". A **scripted** invitee answers at once by its traits (section 3). | Other faction; not within `PK.JOIN`; your company is at `PARTY.MAX` heroes, or an agent invitee would pass `PARTY.MINDS`; invitee in `dungeon/raid/duel/ghost/camp`; an offer to them is already open; invitee leads a company of 2+ ("invite is for one; propose merge to join companies"); the Crypt or a raid is pending for you | `say` (the offer is said aloud: heroes in earshot hear it) |
| `accept` (new, act) | `offer_id` | Joins the inviter's company: `joinCompany(a, C)`; bonds `bondEvent('party')`; one `campaign('join')` line; both agents get the event; `remember` for all members. If you were a solo, your log folds in. | Offer expired or withdrawn; inviter dead, out of `PK.JOIN`, or company full now; you are in a company of 2+ (leave first, or merge); you are in a scene | event + chat ("X rides with us now") |
| `decline` (new, act) | `offer_id`, `text?` | Closes the offer; the inviter hears your line (or "X shakes their head"). | No such offer | `say` |
| `dismiss` (new, act, leader) | `hero_id` | Sends a scripted companion away (section 3): `campaign('dismiss')`, it walks home. Agent members are not dismissed; they are expelled by vote. | Not a companion of yours; you are not the leader; mid-scene | `party_say` |
| `join_party` (existing) | `hero_id` | Becomes "ask to join": toward an **agent** hero it opens an offer from you to their leader (same table as `invite`, reversed); toward a **scripted** hero or party it works as today (6 tiles, gap 3, cap 3, loners refuse, at once). Keeps the name so older sessions still work. | As today, plus the invite refusals | `say` |
| `follow` (new, act) | `hero_id` or `name`, `hours?` (1-12, default until you give another order) | Walk at a hero's side without joining (section 7): `a.pq=[{kind:'follow', id, until}]`. The followed hero gets a soft event "X falls in behind you" and `look` lists "X walks with you". Not a company: no shared XP, no `party_say`, no votes. | Not in sight (`look` range); other faction outside town; you lead a company party of 2+ ("lead_to, or leave first") | event, `look` |
| `leave_party` (existing, +arg) | `where?`, `when_hours?`, `for_good?` ('yes') | Today's split (`splitOff`, `makeMeeting`) without `for_good`; with it `leaveCompany(a)`: a new solo company, bonds cost, `campaign('leave')`, the companions in range hear "X leaves the company" and the far ones learn it on rejoining (`AWAY.KINDS` gains `leave`). | A solo ("you ride alone already"); mid-scene; the Crypt group formed | `party_say` (the parting is said to those in range) |
| `propose kind:'expel'` (new kind) | `hero_id`, `details` | A vote of the present members except the target (the target hears it, may `say`, cannot vote); passes by majority, leader breaks ties; on pass `leaveCompany(target)` with bonds cost on both sides and `campaign('expel')`. | Company of 2 minds ("leave instead"); target out of shouting range; target in a scene; a vote already open | `party_say` + decision scene |
| `propose kind:'merge'` (new kind) | `company` (the other leader's name), `details` | Both companies vote (two proposals linked by `P.pair`); both pass -> `mergeCompanies(A,B)` (the larger keeps its id and name, logs fold); either fails -> both fail. Leaders must be in shouting range of each other. | Sums over `PARTY.MAX` heroes or `PARTY.MINDS` minds; a vote open in either; either in a scene | `party_say` in each company; the other company hears "X's company offers to ride with us" through the leader's `say` |
| `companions` (new, read) | - | Your company as you know it: name; each member's name, class, role label, agent or companion, and **how you know where they are**: "beside you" (in shout range now), else "last seen near <place> at <time>" from `a.seen[id]` (written each tick a companion is in range; a place name, never coordinates), the open meeting plan, couriers out, offers open to you, who follows you. Folds in `earshot` (#395) so one call answers "who hears me, who is near, who is lost". | - | - (own knowledge) |
| `send_courier` (existing, widened) | `to`, `text` | Any **hero you know by name** (met: in `a.talked`/`a.seen`, or in your company), not only companions. Cost by distance from your gate to their last known place. | As today; "you have never met X" | courier event + chat line |
| `post_notice` (new, act) | `text` (<=120) | Pins a notice to your town board for `PARTY.NOTICE_DAYS` 2: "A Warrior seeks companions for the Greenmarch; ask for Kerin at the inn." `list_jobs` and `look` in that town list notices; a reader learns your name and town (`learnPlace`, `talked`). At most one notice per hero. | Not in town; a notice already up | board (read by anyone at that gate) |
| `list_jobs` / `talk` (existing, +rumours) | - | The innkeeper (`talk innkeeper`) and the gate line in `list_jobs` add **sightings**: `S.sightings[]` `{hero, town, at, bound: zoneName}` written when an agent hero passes a town gate or sets out with `move_to` a region. "A Priest called Lorwyn passed through two days ago, bound for the Hollow." Only agent heroes leave sightings, so `npm run sim` is unchanged. `list_jobs` also marks the solo-sized job (section 6). | - | townsfolk (`npc` line) |

Pacing (`sim/pace.js`, `scripts/pacing.mjs`): an open offer to you is a must-answer event (`urgent=2`) with a
60-game-minute window; "lost them" (section 7) is urgent too. The state header carries `offers:[{id, from,
until}]` and `company:{name, size, minds, leader, with_you:[...], apart:[...]}` in place of `fellowship`. The
turn prompts (`scripts/agent-player.mjs`, `fellowship.mjs`) replace "Four companions share your one road" with
the company card from `fellowCard` (which becomes `companyCard(a)` in `persona.js`, size-free).

## 3. Scripted companions

Owner decision 7: an agent hero may invite scripted heroes into its company.

- **Acceptance by traits**, no RNG: the invitee joins when `tm(b,'social')` passes a hash of the two ids
  (`hash(a.id,b.id,...)`, as `locals.js` does), the level gap is at most 3, it is in no party and not busy
  (`dungeon/raid/duel/ghost`), and it has no grudge against a member (`a.nemesis`); otherwise it declines with a
  line from a decline table. It must be of the company's faction (decision 2).
- **Slots**: companions fill the hero slots above the minds (a company of 5 minds takes up to 3; a company of 2
  minds up to 6). They never count toward `PARTY.MINDS`, seats or runners.
- **Play by reflex** (`a.companion = C.id`): follow the leader (the company party's `followPt`), fight, heal
  with class moves (`reflexMay`), drink potions, flee below the reflex threshold, vote by `reflexVote`, act at the
  Table by `reflexFor`. They never lead, never propose, never `party_say` and speak only barks (the scripted bark
  tables, muted when `S.worldVoice` says so). They are not `a.player`: no lore, no notebook, no runner.
- **Leaving**: on `dismiss`, on a split of the company's party that leaves them with no agent member in range
  (they walk home rather than follow a splitter), and on dissolution. They also leave when the last agent member
  of the company dies or leaves (a company never consists of companions only).
- **Deaths**: a companion's death is a background hero's death: its guild's grudge rules apply as today
  (`GUILD_GRUDGE_LVL`, `pvp.js`), the background replacement recruit goes to its guild, and the company is not
  refilled for it (section 8 refills agent seats only). The company log and the members' memories record it.

## 4. Table, council and crawl for any size

**Council** (`sim/council.js`): `F_()` -> `companyOf(a)`; `F.props` -> `C.props`; `voters(P)` = living agent
members and companions of that company present when it was made (as today, `P.absent`; companions vote by reflex
at once); `leaderOfF()` -> `leaderOf(C)`. Quorum: the votes of those present, majority of votes cast, the leader
breaks a tie. A **solo** has no one to ask: `propose` is refused with "You ride alone: decide and act
(take_adventure, go_crypt, join_raid; lead_to is move_to for you)", except `break_camp`. A company of one agent and companions
proposes normally (the companions vote by reflex). `PROP_KINDS` gains `expel`, `merge`, `invite` (optional: a
member asks the company before inviting a stranger; a leader may `invite` without it). `NEED_ALL` (crypt, raid)
means the whole **company** together. A company initiates the Crypt or a raid (#826): a company of 2 goes down as two,
and its raid muster fills from the pool (`unitDraft`). **No level gate** (section 10): a crypt or raid
proposal is never refused for level.

**Reach** (`sim/reach.js`): every function takes the company: `together(members(C), leaderOf(C))`,
`absence(C)` clusters per company, `C.plans`, `C.post`. `witness` is per company. Two companies in range of each
other do not share a channel: `party_say` is your company's; `say` is for everyone in earshot. That is how
companies talk before they merge.

**Camp** (`sim/camp.js`): `CAMP.MIN_CAMP` becomes `Math.min(3, members(C).length)`: a solo makes a one-person
camp (a watch with no sleeper: it heals slower, `CAMP.SOLO_HEAL` .6 of `CAMP_HEAL`, and an ambush finds it
unroused half the time by the same Perception roll). `S.fellowship.camp` -> `C.camp`; two companies may camp at
once (two fires). `campTick` loops `companies()`.

**Table** (`sim/table.js`), owner decision 4:

- `tableOn()` = any company exists and the switch is on. `S.table` becomes `S.tables[]`, **at most one open
  scene per company plus a one-scene queue per company** (`C.tableQ`, a second due moment waits there; a third is
  dropped and its cooldown key left unset so it can come again).
- **At 1x only the followed company's scene pauses the world** (`step()` pauses when `S.tables` holds a scene of
  `followed()`). Every other company's scene runs in rounds on the live clock: its agents still decide, with
  their normal waits (`turnMs` nudge, `liveMs`, `COUNCIL.HOLD_MIN`, the runner-stop hold), while the world goes
  on around it. The members and foes at a live-clock scene are engaged: held in place, not targeted by other mobs
  or duels until it ends (as Crypt groups are hidden today).
- The banner shows the followed scene as today, plus one line per other open scene ("Scene at Mirefen: Dovas and
  company"); clicking it switches the follow (`S.followId`), and that scene then pauses the world.
- A setting **"Pause for any company"** (`TABLE.pauseAll`, saved with the world, off by default) restores
  pausing for every company's scene. 3x/8x stay as today (`TABLE.drop` asks for 1x only for the followed
  company, or for any company with `pauseAll`).
- `open()` takes the company: `sc.company=C.id`, `ids` from `members(C)` (and for `site/room/crawl` those in
  `CRYPT.group.mem`). `present()` = members of `sc.company` in range of the anchor. `lowest()`, `reflexFor`,
  `fellows()` in `apply`/`outcome`/`nextRound` -> `members(C)`. `PLAY` 'all' resolves "in slot order" =
  `C.ids` join order (deterministic for a seed). `tableTick` loops `companies()` in id order.
- A **solo** gets every scene kind: `rescue`, `elite`, `ambush`, `boss`, `check`, `choice`, staged scenes,
  `arrival`; a one-member turn still rolls the foe's round (`foeSlot`) and offers strike/guard/potion/abilities/
  parley/retreat, which is where a solo's hardcore drama lives. Everyone-at-once with one member is one answer.
- `decisionsWaiting()` and `bannerOf()` carry `company` so the runner-stop alert and the banner name whose table
  it is.

**Crawl and the draft** (`crawl.js`, `dungeon.js`, `boss.js`): `crawlFits(g)` = the group holds a member of any
company; the acting members at the table are the company's agent members in `g.mem` (companions and background
fill-ins act by reflex). Room foes scale with the group's hero count (`scaleFoes`, section 1). `unitDraft(list,
pool,n,kind)` takes the company of the first drafted agent hero in `top` and applies all-or-none to **that**
company (companions included); a second company in the same pool is left for the next muster (`CRYPT.cd` 20-45
s). A company whose crypt or raid proposal **passed** is drafted whatever its level: the `CRYPT_LVL`/`RAID_LVL`
filters keep applying to background fill-ins only (section 10). `cryptHold`/`cryptReserved`/`raidReserve` look
across companies (the oldest open crypt proposal holds the Crypt; the raid reserve is the first company with an
open raid vote). `yieldCrypt(C)`. Tally on `C.crawl`; the sim summary sums them.

## 5. Seats and cost

Owner decision 6. A **seat** is an agent-played hero; the DM seat is outside the count.

- **Five agent heroes when any mind is paid** (Claude or OpenAI), across the whole world; **up to ten when every
  mind is local** (Ollama). `SEATS.PAID` 5, `SEATS.LOCAL` 10 in `sim/setup.js`, checked by `validateSetup` and by
  `markPlayer(a,true)` in play (the dossier's Agent button says "seats full: 5 while a paid mind plays").
- The per-company cap still holds: at most `PARTY.MINDS` 5 minds in one company, so ten local seats are at least
  two companies (or solos).
- The setup page warns on turn time when more than five local minds are chosen ("ten local minds share one GPU:
  expect a turn every N seconds each").
- Relay: `RELAY_MAX_RUNNERS` and `SEATS` in `scripts/runners.mjs` follow the seat count plus the DM (6 or 11);
  Claude slots (`RUNNER_CLAUDE_MAX`) are unchanged. Pacing and cost scale with minds, never with companions.

## 6. The DM: every company a thread

Owner addition: the DM's "agent heroes first" **treats every company as a thread, the followed company first
when it must choose**. A member who splits or leaves is a thread of its own (its own company).

`sim/dmfocus.js`: `focus()` -> `focuses()`: one record per company, the followed company first, then id order:
`{company:C, ids, town: CITY row of C.hall, zone, zones, x, y, field, busy, members, lastTouched: C.dmLast}`.
`touchesWhich(e) -> [companyId]`; `tally(e)` bumps `S.dmFocus.acts/fellow` as now and `S.dmFocus.by[companyId]`,
and sets `C.dmLast=S.gameMin`. `share()` is unchanged (any company counts); `fairness()` is new: `{spread,
starved: companies with no action for FOCUS.STARVE_MIN (360) while in the field}`.

- **Order when the DM must choose**: the followed company; then a pending scene or vote; then hurt members in the
  field; then longest since `dmLast`. `fellowshipNeeds()` -> `companies_needs: [...]` in that order;
  `fellowship_change` becomes one signature per company joined with `|`, and `eventDue` fires on any change
  (still `EVENT_MAX` 3 a day, `EVENT_GAP` 120). The standing orders (`fellowNow` in `scripts/dm-agent.mjs`):
  "Every company is a thread. Serve the followed company first, then each other company in turn, the one longest
  without you next; a split-off member is a thread of its own."
- **Reserved shares** (`levers.js`, `reserveOf`): the reserve of each lever's `perDay` stays `FOCUS.RESERVE` .34
  for *any* company; when only the reserve is left, a pull for a company touched in the last `FOCUS.FAIR_MIN` 240
  minutes is refused while another company is starved ("kept for <company> first"); the followed company is
  never refused by this rule. Staged scenes: `STAGE.PER_DAY` becomes `2 + companies()` (3 for one company, as
  today), `STAGE.RESERVE` one kept per company; `whereOf` accepts `near: "company:<id>"`, a company name, a
  member; `partyLvl()` is per company (the staged foe's level is bounded by **that** company, `STAGE.LVL_UP` above
  its average, so a solo at level 4 never meets a level-9 elite staged for the five next door); `PILE_HP` is
  checked against the company the scene is near; staged packs scale with that company's hero count.
- **Hall boards per hall** (`dm.js`): `fellowHook(c,fo)` runs for every town that is some company's hall, one
  ff job per company on that board (`h.company` set so `hallHooks` shows each theirs); `K.FLOOR` 1 applies to
  boards that are nobody's hall; `ffOpen(c, fo)` and `fellowBounty(a,c,z)` take the company. An ff job "fits the
  whole company" whatever its size.
- **Jobs for one** (owner decision 8, both): **every board keeps at least one solo-sized job** (`T.size[0]` 1,
  `h.solo`), paid less (`K.SOLO_PAY` about .6 of the template's pay) and **band-checked**: posted only for a region
  whose band low is within reach of a level-1 to level-band hero of that town's faction (a level-1 solo is never
  handed a Mirefen job; the job's region is the lowest band the board serves that the solo can reach). The DM
  agent stages the better things on top (staged scenes, `post_hook`, `place_person`). Solo jobs are taken by agent
  heroes only (`take_quest`); scripted heroes skip `h.solo`, so the background's adventure mix stays as is.
- `pace.js hallBrief(a)` reads the hero's own company's hall. `dmagent.js fellowship_view` -> `companies_view`.

## 7. Follow

Owner decision 10: **stop and say so**.

- `follow` walks at the followed hero's side (`followPt`-like offset). It stops on any `move_to/hunt/fight/rest`,
  when the followed hero goes hidden (Crypt), enters a town the follower cannot (enemy), or dies.
- **Autopilot keeps pace** while following (`a.playIdle` and the follow step in `travel()`): match the followed
  hero's speed, stay within half the sight range, no stopping to fight or loot (it defends when struck, drinks a
  potion, flees below 15% HP as every reflex does). So losing someone is rare and means something.
- **Lost them**: a follower that loses sight **halts** and gets an urgent event ("You lost sight of Dovas near the
  Hollow road"); the followed hero hears "X has fallen behind" (a soft event and a chat line if in earshot).
  The follow order ends; nothing walks the follower on to a last seen point.
- No position leaks: the event names a place, never coordinates, and only what the follower saw.

## 8. Replacement: seeded into the company, arriving at the table

Owner decision 5. Hard rule: "a fresh level-1 recruit of the same class and guild replaces them".

- `onDeath(a)` in `company.js` writes `C.past`, `campaign('death')`, the memories and reflection moments as
  today, then queues an arrival: `C.arrivals.push({cls, fallen: a.id, runner: a's runner settings, since})`.
- **The recruit is seeded into the company as today**: same class and guild, `SEED_BEHIND` 2 under the lowest
  living member (`recruit(fac, cls)` with `seedLevel`), made when the arrival scene opens (not at the death), so it
  never stands idle in a town the company is far from.
- **The arrival is a DM-narrated Table scene**, kind `arrival` (`PLAY` 'all', everyone at once), opened at the
  company's **next camp or town**, never mid-Crypt or mid-raid (it waits in `C.arrivals` until the company is out
  and settled). The recruit is placed at the camp's edge or the town gate as the scene opens. Options for each
  member: greet, question, object, stay silent (relabelled by the DM like `cast.choices`); the DM agent voices the
  newcomer through `table_call` when it holds the seat, the scripted DM otherwise; the **oath is sworn at the
  table** (the scene's outcome writes `campaign('recruit')` and the join memories). An objection is spoken, not a
  veto: the recruit joins (the seat is the fallen hero's); members who object may `propose expel` afterwards.
- **Agent-played from that moment** as now: `agentMind(a)`, the fallen hero's runner settings carried over, the
  runner's `watchWorld` sees the new id and the supervisor restarts the seat as it does on exit 75.
- **Letters**: the fallen member's `letter`-tagged pinned note goes to the recruit of the same class at the
  arrival, as today.
- A scripted companion's death is not refilled into the company (section 3).
- A company at 3x/8x or with Table Off: the arrival resolves at once with a summary (as other reflex scenes do).

## 9. New World setup: together by default, apart as an option

`sim/setup.js`: the setup becomes

```
{v:2, world, seed, mode:'together'|'apart', name?,
 heroes:[{cls, name?, race?, fac, mind, profs?, archetype?, start?:{town?:name|'home', region?:name}}],   // 1..seat cap
 dm:{mode, provider?, model?}}
```

- `mode:'together'` is the **default, permanently** (owner decision 3): one company of all heroes in one hall
  (today's behaviour; all `fac` equal, `start` ignored). A New World with no choices plays exactly as today, and
  the default world's seeded hashes and fixtures are not re-baselined for this epic's setup work.
- `mode:'apart'` founds one solo company per hero at its `start.town` (default: its people's home town,
  `homeOf`), optionally seasoned to its `start.region`'s band low (`season(a, band[0])`, `opening.js`), else level
  1 in town. Apart heroes are single-faction per company but the world may hold both factions.
- `validateSetup`: 1 to the seat cap (section 5) heroes, each a legal class for its faction, names unique,
  `together` needs one faction and at most `PARTY.MINDS` heroes; the paid/local seat rule; the turn-time warning
  above five local minds. `cleanSetup` migrates a v1 setup (`slots` -> `heroes` in `SLOT_KEYS` order,
  `mode:'together'`) so the viewer's last setup and the URL still load. `resolveArchetype(setup, i)` by index.
- `planRunners`: one `company` runner per company whose members share one mind, else hero runners; plus the DM.
- Presets (`PRESETS`): `classic` (today: Warrior, Priest, Mage, Hunter, Rogue, together, one faction, the
  default); apart presets **`five-solos`** (the same five, each alone in a home town of the faction, level 1) and
  **`pairs-and-solo`** (two pairs and a solo); `local`/`claude`/`haiku`/`last` keep setting minds.
- The setup page (`ui/setup.js`) gets a Together/Apart switch (Together selected), a hero count, per hero a start
  town picker filled from `CITY` of its faction in Apart, and the seat and turn-time notes. `opening()`:
  `found(pick)` -> `foundCompany(ids, {name, hall})` per group; `ELDMOOR_FELLOWSHIP=0` keeps meaning "no agent
  heroes at all".
- **One company check covers the apart path** (`npm run companycheck`, section 11); no other check moves to it.

## 10. Danger made legible, no level gate (owner addition)

The game **never refuses a crypt or raid proposal for level**. Context: in the live behavior logs 7 of 18 deaths
were level 1-4 parties lost in the Crypt. The danger is made legible in the world instead; agents decide, the game
does not stop them.

- **A weathered sign at the Crypt stair**: a landmark sign in the Crypt's spec entry (`world/spec.js`, drawn by
  `render/`), read by `look` near the stair ("Those who went below were tried blades. Turn back, green ones.").
- **The gate captain's warning** when a green company asks (`talk captain` or `list_jobs` at a gate, `locals.js`
  and `dm.js` gate lines): "green" = the company's lowest agent member below the Crypt region's band low.
- **The lore threat read on first sight of the stair** (`lore.js`): a place read like a creature's, from the
  region band against the hero's level, by the same hash, no RNG; it marks the place `danger` in `placesView`.
- **DM narration framing the descent**: the Crypt `site` scene's frame names the danger in words when the group is
  green (scripted DM), and `companies_needs` lists "a green company at the stair" for the DM agent.
- **A line in the proposal text itself**: `propose kind:'crypt'` (and `raid`, for Kragmaw) from a green company
  appends "Those who went below were tried blades; you are not." to the proposal everyone hears.
- A passed proposal drafts the company whatever its level (section 4). Reflex-only companies (as in `npm run sim`)
  never propose, so the background's level filters and hashes are unchanged.

## 11. Determinism, balance risks and checks

Determinism:

- Iterate companies by id, members by `C.ids` (join order), proposals by id; never by `Map` insertion of live
  objects. Several open scenes are ticked in company id order; tie-break two due moments by company id.
- No RNG in any new tool path: scripted invitees answer by a hash of ids; sightings, notices, warnings and the
  stair read are plain data or hashes.
- The seeded no-Fellowship world (`ELDMOOR_FELLOWSHIP=0`) must hash the same before and after every slice
  (`node scripts/professioncheck.mjs --hash`, `CRAWL_BASELINE_HASH`). The seeded **default** world (together)
  keeps its hash through the refactor slices. Slices whose behaviour reaches the default company (the arrival
  scene, foe scaling only if a size other than five occurs, solo jobs on boards) state in their PR whether a hash
  moved and why; none of them changes the default start.
- `npm run sim -- 60` and `-- 120` before and after each slice; report deaths, levels, crypt and Kragmaw.

Balance risks:

- **Solos die.** A level-1 solo with no healer, hunting alone, is the hardcore story the owner asked for; expect
  2-3x the together company's death rate per agent hero in apart worlds. Mitigations: the solo `rescue` scene, the
  solo camp, solo-sized band-checked jobs, scripted companions, the legible Crypt danger, the setup's
  `start.region` seasoning. Measure: deaths per agent hero per game day, by company size, in `behavior.js`
  (`world.jsonl` gains `companies:[{id, size, minds, deaths}]`).
- **Crypt deaths of green companies.** No level gate means agents can still choose to die below; the warnings
  must be read. Measure the share of Crypt deaths by company level band before and after slice 9.
- **Table pauses.** Only the followed company pauses at 1x, so apart worlds do not stall; the risk moves to
  live-clock scenes the watcher does not see. The banner line and `pauseAll` cover it.
- **Runner seats and cost.** Five paid seats as today; ten local seats on one GPU are slow (the setup warning).
- **DM starvation.** Levers at `perDay` were sized for one company; the fairness refusal and the per-company staged
  reserve spread them. `dmcheck` asserts share >= 60% as now and adds "no company starved over 150 game hours".
- **Big companies.** Eight heroes in a crawl room: foe scaling keeps the room's danger per hero; the Table turn
  order grows to eight (five deciding minds, three reflexes).
- **Scripted world drift.** `seekParty`, `partyTick`, the Crypt pool and the raid pool must not see companies as
  anything but parties they already handle (`p.company` where `p.fellow` was).

Checks to add or update (CI groups run sequentially, see `check_fixtures` memory):

- **`npm run companycheck`** (new, `scripts/companycheck.mjs`): the one check of the apart path. Seeded; the
  `five-solos` preset founded apart; sightings and a courier by name; `invite` refused out of range, accepted in
  range; a scripted companion accepting by traits, playing by reflex, dismissed; the 8/5 caps; `merge` and
  `expel`; `leave_party for_good`; `follow` with autopilot keeping pace and a "lost them" event; a solo `rescue`
  scene; two companies' scenes open at once, only the followed one pausing, the banner switch; a death refilled by
  an arrival scene at the next camp; save mid-everything and restore; the seeded no-company hash unchanged.
- `tablecheck`: scenes keyed by company, the per-company queue, `pauseAll`, a company of 2 in everyone-at-once, a
  solo decision refusal, the `arrival` kind with and without a DM voice.
- `crawlcheck`: a company of 3 plus two fill-ins (only the three agents decide); foe scaling for 3 and 8 heroes; a
  green company drafted after a passed proposal.
- `dmcheck`: `companies_needs` order (followed first), hall jobs on two boards, the solo job band check, staged
  `near:"company:2"`, the fairness refusal, per-company `STAGE.LVL_UP`.
- `setupcheck`/`setupsmoke`: v1 setup migration, together default unchanged, the apart presets, the paid/local seat
  rule and warning, `planRunners` per company.
- `savecheck`: a v6 fixture with a Fellowship, a split member and a mid-scene table. `channelcheck`: `companions`
  never carries a far member's position or HP; an `invite` text reaches only earshot; notices carry only the text;
  "lost them" names a place only. `uismoke`: two company rows, follow cycle, the sheet with 2 and 8 columns, the
  scene line switch. `localcheck`/`runnercheck`: `kind:'company'` runner, a solo on a hero runner, 10 local seats.
- `balance-tester` report: 10-run batch of `npm run sim -- 120` with `classic` (together) and `five-solos`.

## 12. Slicing (12 PRs)

Every slice is S or M. Owners and files:

| # | PR (branch) | Size | Owner | Files | Depends on | Parallel with |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `ai/company-model`: `sim/company.js` (data, `PARTY.MAX/MINDS`, `foundCompany/joinCompany/leaveCompany/mergeCompanies/onDeath` with today's instant seeded replacement, helpers, `roleOf`, `followed()`), `fellowship.js` shims, `save.js` v7 migration + `describeSave`, `state.js` `S.companies/S.followId`, `party.js` `p.company`, `notebook.js` letters, `render/dungeonview.js` tally read. Default world hash unchanged; `savecheck` fixture. | M | ai-designer | `sim/company.js`, `fellowship.js`, `save.js`, `state.js`, `party.js`, `notebook.js`, `render/dungeonview.js` (one line), `scripts/savecheck.mjs` | - | - |
| 2 | `brain/council-any-size`: council, reach, camp, earshot per company; solo refusals; `expel`/`merge` kinds; `CAMP.MIN_CAMP` rule; no level refusal and the green-company line in crypt/raid proposals. `campcheck`, `tablecheck` votes. | M | brain-builder | `council.js`, `reach.js`, `camp.js`, `earshot.js`, `scripts/campcheck.mjs` | 1 | 3, 6, 9, 11 |
| 3 | `brain/table-per-company`: `S.tables`, one open scene and a one-scene queue per company, followed-only pause at 1x, live-clock scenes (engaged members), `TABLE.pauseAll`, `TABLE.drop` for the followed company, solo scenes. `tablecheck`. | M | brain-builder | `table.js`, `tableround.js`, `index.js` (the pause in `step()`), `scripts/tablecheck.mjs` | 1 | 2, 6, 9, 11 |
| 4 | `ai/crawl-draft-companies`: crawl and `unitDraft` per company, `scaleFoes` in crawl rooms, a passed proposal drafts a green company, `cryptHold`/`raidReserve` across companies. `crawlcheck`. | S | ai-designer | `crawl.js`, `dungeon.js`, `boss.js`, `scripts/crawlcheck.mjs` | 1, 3 | 5, 6, 9 |
| 5 | `ai/arrival-scene`: `C.arrivals`, the seeded recruit made at the scene, Table kind `arrival` (`PLAY` 'all', next camp or town, never mid-Crypt), oath at the table; DM agent voice through `table_call`, scripted voice otherwise. `tablecheck` arrival. | S | ai-designer (`company.js`, `table.js` kind row), brain-builder (`staged.js` voice, `scripts/dm-agent.mjs` table voice prompt) | `company.js`, `table.js`, `staged.js`, `scripts/dm-agent.mjs`, `scripts/tablecheck.mjs` | 1, 3 | 4, 6, 9 |
| 6 | `ai/dm-companies-first`: `focuses()` with the followed company first, every company a thread, fairness, hall boards per hall, staged per company (level bound, packs scaled), `companies_needs`, DM standing orders. `dmcheck`. | M | ai-designer (`dm.js`, `dmfocus.js`, `staged.js`, `levers.js` one line), brain-builder (`dmagent.js`, `scripts/dm-agent.mjs`) | as named | 1 | 2, 3, 4, 9, 11 |
| 7 | `ai/solo-jobs`: one solo-sized, band-checked, lower-paid job on every board (`h.solo`, `K.SOLO_PAY`), agent heroes only; `list_jobs` marks it. `dmcheck` band check. | S | ai-designer | `dm.js`, `data/` job templates (creature/character tables untouched), `player.js` (one line), `scripts/dmcheck.mjs` | 6 | 8, 9, 10 |
| 8 | `world/crypt-warnings`: the stair sign (spec data + its drawing), the gate captain's warning to a green company, the lore read of the stair, the `site` scene frame line. | S | world-builder (`spec.js`), pixel-artist (the sign's sprite), ai-designer (`lore.js`, `locals.js`, the `site` frame in `table.js`) | `world/spec.js`, `render/places.js`, `lore.js`, `locals.js`, `table.js` | 3 | 7, 9, 10 |
| 9 | `ai/grouping-tools`: `invite/accept/decline`, `join_party` semantics, scripted companions (acceptance by traits, reflex play, `dismiss`, leaving rules), `leave_party for_good`; pace header `company`/`offers`. `companycheck` (first part), `channelcheck`, `playcheck`. | M | ai-designer (tools), brain-builder (prompts in `scripts/`) | `player.js`, `data/player-tools.js`, `company.js`, `pace.js`, `scripts/pacing.mjs`, `agent-player.mjs`, checks | 1, 2 | 3, 4, 5, 6 |
| 10 | `ai/follow-and-find`: `follow` with autopilot keeping pace and the "lost them" urgent event, `companions`, `post_notice`, sightings, courier by name. `companycheck` (second part), `channelcheck`. | S | ai-designer | `player.js`, `data/player-tools.js`, `heroes.js` (the follow step), `reach.js`, `locals.js`, `notify.js` | 9 | 7, 8, 11 |
| 11 | `ai/setup-apart`: setup v2 with `together` default, the apart presets, seat caps (5 paid, 10 local) and the turn-time warning, `opening()` per company, `planRunners`; setup page switch, start towns, notes. `setupcheck`, `setupsmoke`, `companycheck` apart start. | M | ai-designer (`sim/setup.js`, `opening.js`), ui-designer (`ui/setup.js`) | as named | 1 | 2, 3, 6, 9, 10 |
| 12 | `ui/companies` + `brain/company-runners` (two PRs, landed together): frames per company (up to 8), follow cycle, sheet, Companies panel, the scene line switch and "Pause for any company" switch, chat and banner names; `scripts/fellowship.mjs` -> company runner, `runners.mjs` kind `company` and seats from the seat count, `/play/health` `company`; shims deleted; CLAUDE.md hard-rule rewrite to "company", `docs/LORE.md`, memories. `uismoke`, `localcheck`, `runnercheck`, `behaviorcheck`. | M each | ui-designer; brain-builder, lore-keeper (names), balance-tester (report) | `ui/frames.js`, `sheet.js`, `fellowship.js`, `controls.js`, `table.js`, `chatpanel.js`, `agents.js`, `runners.js`, `lifeview.js`, `layout.js`; `scripts/*.mjs`, `sim/player-host.js`, `behavior.js`, docs | 1-11 | - |

Order: 1 alone on `main` first (it renames shared fields; nothing else may touch `fellowship.js` meanwhile).
Then 2, 3, 6, 11 in parallel worktrees (disjoint files). Then 4 and 5 (after 3; 5 and 8 both touch `table.js`,
so they go one after the other), 9 (after 2), 7 (after 6, both `dm.js`). Then 8 and 10. Slice 12 closes the epic.
There is **no default-start flip PR** and no default-world re-baseline. Every PR pastes `npm run sim` and the
seeded hash line; 1, 3, 4, 5, 7 and 11 add `npm run sim -- 120`.

## 13. Decisions (owner, 2026-11-03)

1. **Cap.** Two numbers: a company holds up to **8 heroes** (`PARTY.MAX`), of which at most **5 are agent
   minds** (`PARTY.MINDS`); the rest are scripted companions. Pacing and cost follow the mind count; crawl and
   elite foe counts scale with the hero count. (Sections 1, 3, 4, 6.)
2. **Factions.** Single-faction companies now. Mixed companies are a later epic with their own consequences
   (enemy towns refuse them, their guilds treat them as deserters), not a flag. (Section 1.)
3. **Default start.** Together stays the default, permanently. "Apart" is a setup option with presets ("five
   solos", "two pairs and a solo"). Discovery comes from the verbs, scripted companions and the DM treating a
   split-off member as a thread. No end-of-epic flip, no default-world re-baseline; one company check covers the
   apart path. (Sections 9, 11, 12.)
4. **Pausing.** At 1x only the followed company's Table scene pauses the world; other companies' scenes run in
   rounds on the live clock with their normal waits and a banner line ("Scene at Mirefen: Dovas and company")
   that switches the follow. One-scene queue per company. A "pause for any company" setting. 3x/8x stay.
   (Section 4.)
5. **Replacement.** Seeded into the company as today (`SEED_BEHIND` 2 under the lowest living member); the arrival
   is a DM-narrated Table scene at the next camp or town (never mid-Crypt), everyone at once; members greet,
   question or object; the DM agent voices the newcomer when it holds the seat, the scripted DM otherwise; the
   oath is sworn at the table; agent-played from that moment. (Section 8.)
6. **Seats and cost.** Five agent heroes when any mind is paid; up to ten when every mind is local, with a
   turn-time warning on the setup page. The DM seat is outside the count. (Section 5.)
7. **Scripted companions.** Allowed by invite (traits decide acceptance); they fill the non-mind slots, play by
   reflex, never lead or speak beyond barks, and leave on dismissal, a split or dissolution; their guild's grudge
   rules still apply to their deaths. (Section 3.)
8. **Jobs for one.** Both: every board keeps at least one solo-sized job (lower pay, band-checked); the DM agent
   stages the better things on top. (Section 6.)
9. **The name.** Company. "Fellowship" and "pack" stay as names a company may carry (`NAME_PARTS`); docs and the
   hard rules get one rewrite to "the company/companies" where they mean the generic thing. (Intro, slice 12.)
10. **Follow range.** Stop and say so: a follower that loses sight halts with an urgent "lost them" event; the
    followed hero hears "X has fallen behind"; autopilot keeps pace while following. (Section 7.)

Additions:

- **No level gate on Crypt or raid drafts**; danger made legible in the world (stair sign, gate captain, lore
  read, DM framing, a line in the proposal). (Section 10.)
- **The DM treats every company as a thread**, the followed company first when it must choose. (Section 6.)

Points that need the owner's wording (not resolved here):

- The CLAUDE.md hard rule "The Fellowship is always agent-played ... there is no scripted or single-call AI mode
  for members" meets decision 7: scripted companions are reflex-played members of a company. Section 3 keeps them
  outside the minds (no decisions of an agent hero are scripted), but the hard rule's text needs the owner's
  rewrite in slice 12, as does "Table mode pauses the world at 1x" (decision 4: only the followed company).
- Decision 5 when a solo dies: there is no living member to seed under and no one at a camp to greet the recruit.
  This doc assumes the recruit arrives at level 1 (as `recruit()` does today with no living mates) and the arrival
  scene plays in the hall town with the recruit alone. The owner may prefer otherwise.
- Decisions 1 and 6 read together: this doc takes 5 minds as a per-company cap and 5 paid / 10 local as a
  per-world seat count.
- Decision 8 says every board; posting solo jobs changes board contents in the default world (and in the
  no-Fellowship world unless they are posted only where an agent hero could take them). Slice 7 restricts taking
  them to agent heroes; whether the seeded hashes may move for the board contents is the owner's call.
