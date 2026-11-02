# Agentkit: the seam between the agent-play engine and the game

Step 1 of epic #290 (issue #294). Design only: no code moves in this step. The owner reviews this before step 2
starts. Everything below was read against `main` at cf65828 (2026-11-02).

Goal: a second game (agents play seats, a GM agent runs the table) reuses Eldmoor's agent framework without
copying it. The engine is everything that knows about **seats, runners, turns, models, memories and scenes**;
the game is everything that knows about **heroes, zones, classes, dice, quests and the Fellowship**.

## 1. Words

| Term | Meaning | Eldmoor today |
| --- | --- | --- |
| seat | one mind slot a runner claims: a player seat or the GM seat | a hero id, or `dm` (`DM_KEY`) |
| host | the process that owns the world and answers tool calls | the game page (`src/ui/player-bridge.js`) or `scripts/play-headless.mjs` |
| relay | the local HTTP server between runners and the host | `scripts/relay.mjs` + `relay-mcp.mjs` + `runners.mjs` |
| runner | one process that plays one seat (or a party of seats) with a model | `agent-player.mjs`, `fellowship.mjs`, `dm-agent.mjs` |
| turn | one runner wake: brief, model calls, tool calls, narration | pacing #126 |
| decision point | a moment that waits for a seat's agent, with a reflex fallback | choices, votes, Table turns |
| scene | a decision point that gathers several seats, `turns` or `all` | Table mode (`src/sim/table.js`) |
| adapter | the object a game hands the engine (section 2) | to be written: `src/game/adapter.js` |

## 2. The game-adapter interface

What a game supplies. Each item: the contract, then Eldmoor's value today. The engine never imports game
modules; it only calls the adapter. Where Eldmoor already has a registry (`setSceneKind`, `setRunnerLinks`,
`setChapterWriter`, `setProposeHook`), the adapter reuses that pattern.

### 2.1 Identity, seats and the clock

- `id`, `title`, `worldId()` (instance id, for purging mirrors and sessions on a new world), `worldName()`
  (log folder). Eldmoor: `'eldmoor'`, `S.worldId`, `WORLD_ID` from `src/world/map.js`.
- `seats()` -> `[{id, name, alive, party?, role?, lead?}]` for `/play/health` and claims; `gmSeat()` -> open or
  closed. Eldmoor: `playerSeats()` (`src/sim/player.js`), the `info()` of `localBackend` in `play-headless.mjs`
  and of `browserBackend` in `relay-mcp.mjs`; `dmSeatOn()`.
- `seatState(seat)` -> the plain object the engine may keep its per-seat state on (events, notebook, tiers,
  reflect, turn hold). Eldmoor: the hero object `a` (fields listed in 2.10).
- `clock` -> `{now() game minutes, day(), text(), speed(), paused(), requestDrop(reason)}`. Eldmoor:
  `S.gameMin`, `dayNo()`, `clockStr()` (`src/sim/state.js`), `TABLE.speed`, `TABLE.drop`. A turn-based game
  supplies a clock that advances per round; pacing (2.4) then reads rounds, not minutes.
- `alive(seat)` and the death rule. Eldmoor: hardcore, `state==='dead'` answers every tool "dead".

### 2.2 Player tools

- `playerTools`: a data table `[{name, desc, act, args:{k:{type, desc, optional?, enum?}}}]`, the shape of
  `src/data/player-tools.js` (49 tools). The engine turns it into MCP (`buildMcp` -> `zodFor`), Ollama tool
  specs (`ollamaTools`), JSON-action schemas (`actionSchema`) and argument cleaning (`cleanArgs`).
- `act(seat, tool, args)` -> `{ok, ...} | {pending}`: one game tool. Eldmoor: the `T[tool]` table inside
  `playerAct`. The engine wraps it (2.3).
- `waitOver(pending)` / `finishWait(pending, realOut)`: the game's `wait`. Eldmoor: `player.js`.
- The engine contributes **kit tools** appended to the game's table: `remember`, `recall`, `update_memory`,
  `forget`, `pin`, `journal_read`, `journal_write`, `journal_search`, `chat_read`, `scene_act`, `vote`,
  `wait`. Today they sit in `PLAYER_TOOLS` and `DM_TOOLS` beside game tools.

### 2.3 What the engine wraps around every call (no adapter work)

From `playerAct` today: unknown tool, not-a-seat and dead checks; the `act` rate limit (`PK.RATE` per game
hour); turn open/close (`turnStart`/`turnEnd`, the #240 hold); pending events attached to the result
(`takeEvents`, `PK.EV_OUT`); `as_of` and `since_look` staleness (`PK.STALE`); the call log (`logCall`,
`a.playLog`); `playActAt` for autopilot. The adapter adds: `sinceLook(seat, args)` (what moved since the last
look, #240) and `lookSnap(seat)`; both optional.

### 2.4 State header (the brief)

- `brief(seat)` -> an object with **kit fields** the engine fills (`clock`, `news`, `memories`, `reflect`,
  `scene`, `heard`, `met`, `autopilot`) and **game fields** the game fills. Eldmoor's game fields:
  `state, doing, hp, level, place, foe, camp, table, nearby, quest, warning` (`paceBrief` in `src/sim/pace.js`).
- `briefText(brief)` -> prompt text. Eldmoor: `briefText`, `talkText`, `memoryNote`, `questNote` in
  `scripts/pacing.mjs` (these name "HP", "foe", "quest", tools like `move_to`).
- `staleClaim(narration, before, after, tools)` for the behavior anomaly (optional). Eldmoor: `FIGHT_WORDS`,
  `FIGHT_STATES`, `FIGHT_TOOLS` in `scripts/behavior-log.mjs`.

### 2.5 Events, urgency and wakes

The engine owns the event queue and its levels (`src/sim/notify.js`): `notify(seat, text, urgent, wake)`,
levels 3 (must answer in time), 2 (at once), 1 (after the gap), 0 (read with the next tool). The game decides
**what** is an event. Eldmoor: ~every module calls `notify`; `src/sim/wakes.js` bundles XP, loot, quests and
level-ups (game content on the engine queue). `PK.HEAR_WAKE` (a heard line wakes the listener) is a kit rule
with a game constant.

### 2.6 Decision points

Kit: the runner-link primitives of `src/sim/runlink.js` (`setRunnerLinks`, `setReflexAck`, `agentLive`,
`reflexMay`, `ownerHeld`), the hold windows (a live agent is waited for, a gone runner holds until the owner
answers, no host means reflex at once), the must-answer event, the 1x drop. Game: each decision's options,
its reflex and its windows. Eldmoor:

| Decision | Options / reflex | Windows |
| --- | --- | --- |
| adventure choice | `a`/`b`, `playerBranch` (`player-choice.js`) | `CHOICE_MIN` 180, `CHOICE_HOLD` 600 game min |
| council vote | `PROP_KINDS`, `reflexVote` (`council.js`) | `COUNCIL.PROP_MIN` 120 + `HOLD_MIN` 600 |
| Table turn | `optionsFor`, `reflexFor` (`table.js`) | `TABLE.turnMs` 7 s nudge, `liveMs` 120 s |
| GM table call | `COMPLICATIONS[kind]`, scripted fill (`staged.js`) | `TABLE.dmMs` 6 s |
| autopilot | `autopilot(a)` (`player.js`) | `PK.IDLE` 120, `PK.HOLD` 180 |

### 2.7 Scene kinds

The engine runs the scene lifecycle (open, frame, order, wait, nudge, reflex, resolve, outcome, step mode
#285, pause at 1x, save mid-scene as plain data). A game registers each kind, the shape `setSceneKind` already
takes: `{play:'turns'|'all', options(sc, seat), reflex(sc, seat), apply(sc, seat, act), outcome(sc), trigger?,
cooldown?, anchor?}`, plus `order(seats)` (initiative) and `inRange(seat, anchor)` for `all` scenes.

Eldmoor's kinds: built in `site, room, boss, elite, ambush, rescue, check, choice, decision` (hard-coded
branches in `table.js` `baseOptions`, `reflexFor`, `apply`, `COOL`, `COMBAT`); registered `crawl`
(`crawl.js:154`) and `meeting, trap, mystery, social` (`staged.js:361`). `PLAY` in `table.js` says which are
`turns` and which `all`. Order: Reflex score (`score` from `abilities.js`); combat rounds `tableround.js`.

### 2.8 GM seat

- `gmTools`: the data table of `src/data/dm-tools.js` (26 tools) and `gmAct(tool, args)` (`dmAct` in
  `src/sim/dmagent.js`).
- Kit GM tools and state: notes in sections (`NOTE_SECTIONS`, `notes_read`/`notes_write`, the notebook
  tools), `narrate {text, near, radius}` with a daily cap, `log_intent`, the per-turn record
  (`S.dmAgent.turns`, #181), the call log, `table_call`/`table_answer` for staged scenes, the seat open/closed
  switch, the campaign seed parser (`src/sim/campaign.js`, Markdown sections).
- Game GM tools: `dm_status`, `read_timeline`, `fellowship_view`, `heroes_near`, `npcs`, `regions`, `hooks`,
  `levers`, `pull_lever`, `npc_say`/`npc_call`/`npc_offer`, `stage_scene` content (`src/sim/levers.js`,
  `staged.js`, `talk.js`).
- `playersFirst()` -> `{summary, items, quiet, signature}`: what the players need now and a signature whose
  change wakes the GM. Eldmoor: `focus()` in `src/sim/dmfocus.js`, `fellowship_needs` / `fellowship_change`
  read by `fellowNow` and `eventDue` in `scripts/dm-agent.mjs`. The reserved lever share (`FOCUS.RESERVE`) is
  game.
- `gmCadence`: when the GM takes a turn besides events. Eldmoor: `EVENING` 18:00 (`dm-agent.mjs`).

### 2.9 Channels (who hears what)

Kit rule (#123): seats talk only through the game; the relay never carries text between seats; a claimed
seat answers only its runner; GM and player tools never cross. The game supplies `hear(listener, line)`
reach: Eldmoor `HEAR` 7 tiles (`chat.js`), shouts `REACH.SHOUT` 12 (`reach.js`), couriers, the table. For
the check, the adapter supplies `plantSecrets()` and `gatherSeatOutputs()` so `channelcheck` can run on any
game (today `scripts/channelcheck.mjs` plants into `S.dmAgent`, journals, `a.persona` directly).

### 2.10 Persistence hook

The engine keeps its state as plain JSON on objects the game saves; the game's snapshot/restore must carry
them. Today (names kept in step 2, see risks):

- per seat: `a.player, a.pq, a.playEv, a.playEvN, a.playEvSeen, a.playLog, a.playNarr, a.playTurn,
  a.playIdle, a.playAuto, a.playOrder, a.playActAt, a.playRate, a.playLook, a.playFresh, a.journal,
  a.memories, a.tiers, a.reflect, a.brain, a.brainCfg, a.mind, a.chat`;
- world: `S.playerHeroes, S.worldId, S.table, S.dmAgent, S.staged, S.fellowship.props` (votes),
  `S.fellowship.letters`.

Adapter: `persist: {seatRoots(), worldRoot(), migrate(save)}`; Eldmoor's is `src/sim/save.js` (`snapshot`,
`restore`, `normalize*` hooks). Landmarks for tiers come from the game too: `mark(seat, kind, text)`; Eldmoor
feeds them through `onRecord` (`history.js`) and `memoryLine` (`memory.js`).

### 2.11 Prompts and single decisions

- Runner prompts: `systemPrompt(seat)`, standing orders, `turnPrompt(n, wake)`, `resumeNote`, local rules and
  re-prompt text that name tools. Eldmoor: `systemPrompt`, `KNOWLEDGE_ORDERS`, `TOWN_ORDERS`,
  `MEMORY_ORDERS`, `JOURNAL_ORDERS`, `turnPrompt` (`agent-player.mjs`); `dmSystemPrompt` and the `DM_*_ORDERS`
  (`dm-agent.mjs`); `TABLE_SYSTEM`, `TALK_SYSTEM`; `LOCAL_RULES`, `REPROMPT` (`local-agent.mjs`); MCP
  `INSTRUCTIONS`/`DM_INSTRUCTIONS` (`relay-mcp.mjs`).
- Single decisions (`/decide`, the background-hero brain): `kinds`, `systemFor(kind, ctx)`, `schemaFor(kind,
  options)`, `maxTokens`, `validate`, `scripted` fallback. Eldmoor: `src/data/prompts.js`, `src/sim/brain.js`
  (`SCRIPTED`, `snapshotFor`), `systemFor(kind, FAC index)` in `relay.mjs`.
- Reflection kinds (`reflect.js` `KINDS`) and memory examples are prompt content; the moment budget is kit.

### 2.12 Watch hooks

`digest()` every game hour and `anomalies()` for `world.jsonl`/`anomalies.jsonl`. Eldmoor: `makeWatch` in
`src/sim/behavior.js` (per-member mind share, DM levers, votes, deaths). The relay-side detectors and the
report are kit.

## 3. Module map

Verdicts: **engine** moves to `agentkit/` as is (with the listed cuts), **game** stays, **split** is cut in two.

### 3.1 `scripts/`

| File | Verdict | Reason | Seams to cut |
| --- | --- | --- | --- |
| `relay-mcp.mjs` | engine | claims, links, routes, MCP, WS bridge are game-free | imports `PLAYER_TOOLS`/`DM_TOOLS`; `INSTRUCTIONS`/`DM_INSTRUCTIONS` strings; `X-Eldmoor-*` headers; `hero` in every body |
| `relay.mjs` | split | HTTP server, `/decide`, timeouts, cost log, limiter wiring are kit | `FAC` and `prompts.js` (`KINDS`, `systemFor`, field caps); `/decide` kinds list |
| `runners.mjs` | engine | supervisor, slots, session budget, restart on 75 | `RUNNER_KINDS` script paths and the `fellowship` kind; `SEATS` 6 |
| `pacing.mjs` | split | `makePacer`, `failTracker`, `turnCap`, Claude slots, `watchWorld`, reflection close | `briefText`, `talkText`, `memoryNote`, `questNote` are game text |
| `local-agent.mjs` | engine | the tool loop, JSON fallback, text-call parsing, scene and reflect turns | default `list = PLAYER_TOOLS`; `LOCAL_RULES`/`REPROMPT` name `look, move_to, hunt`; `notEnglish` from `src/sim/lang.js` |
| `agent-chat.mjs` | engine | OpenAI runner start-up | none |
| `warmup.mjs` | engine | the start gate warm-up | none (talks `/play/ready` only) |
| `providers/*` | engine | adapters, limiter, `num_ctx`, prices | none; `google.mjs` stub stays a stub |
| `agent-sessions.mjs` | engine | one session file per seat, atomic writes, old-world moves | `heroId` naming; `DM_RUNNER_KIND` duplicates `RUNNER_KINDS.dm` |
| `agent-player.mjs` | split | the runner loop (claim, pace, turn, report, warm-up, new-world exit) is kit | `systemPrompt` and the orders; MCP server name `eldmoor` |
| `fellowship.mjs` | split | a multi-seat runner (one process, N members, a queue) is kit | the party roles, `--follower-model` by leader, imports prompts from `agent-player.mjs` |
| `dm-agent.mjs` | split | GM loop, cadence, backoff, `tableVoice`, `talkVoice` | `dmSystemPrompt`, orders, `fellowNow`, `eventDue` on `fellowship_change`, `EVENING`, `TABLE_SYSTEM`, `TALK_SYSTEM` |
| `behavior-log.mjs` | engine | writer, rotation, scrub, relay detectors | `staleClaim` word lists; imports `similar` from `local-agent.mjs` and `lang.js` |
| `behavior-turn.mjs` | engine | turn line, `usageDelta` | none |
| `behavior-report.mjs` | engine | report from the logs | section titles say "Fellowship" |
| `mind-compare.mjs` | split | the table is kit | imports `WRITE_KINDS` from `src/data/prompts.js`; "member" rows |
| `memory-mirror.mjs` | engine | Markdown mirror, world purge | seat payload fields `lvl`, `cls`; `LIFE.md` layout of tiers |
| `mcp-stdio.mjs` | engine | stdio MCP | `PLAY_HERO` env name |
| `campaign-files.mjs` | engine | reads `docs/campaigns/` | imports `provideCampaigns` from `src/sim/index.js`; dir by parameter |
| `play-headless.mjs` | split | the headless host (backend, timers, behavior, mirror) is kit | `init`, `found`, `autoPick`, `markPlayer`, flags `--fellowship`, `--agents` |
| `up.mjs` | engine | launcher (#243) | default ports, `start-eldmoor.cmd` name |
| `playcheck`, `localcheck`, `runnercheck`, `behaviorcheck`, `openaicheck` | split | most asserts are kit asserts on an Eldmoor world | the kit half reruns on adapter 2 |
| `channelcheck`, `tablecheck`, `dmcheck` | split | the rule and the scene/GM framework are kit | secret planting and Eldmoor scene kinds stay |

### 3.2 `src/sim/`

| File | Verdict | Reason | Seams to cut |
| --- | --- | --- | --- |
| `notify.js` | engine | the event queue and levels | `clockStr` import -> `clock.text()` |
| `runlink.js` | engine | runner links, reflex, owner hold | none: no imports |
| `player-host.js` | engine | tool call with waits, `hostPace` | imports `playerAct`, `lookSnap` (`player.js`), `paceBrief` |
| `player.js` | split | the `playerAct` envelope, turn hold, events, rate, journal tools are kit | the `T` table (the game tools), `playerUpd`, `autopilot`, `jobFit`; 25 imports of world, data, combat, quests |
| `player-choice.js` | split | choice hold windows are kit | `playerBranch` adventure branches |
| `pace.js` | split | `paceCheck`, `paceIdle` are kit | `paceBrief` game fields; `tableView`, `asleep` (`camp.js`), `foeName`, `localsNear`, `questBrief`, `ZONES` |
| `wakes.js` | game | which XP, loot, level-up events wake | uses kit `notify` |
| `reflect.js` | engine | moments, budget, close | `KINDS` labels (camp, oath, trade) become registered |
| `notebook.js` | split | book ops, caps, ranking, mirror dirt are kit | `resolveAbout`, `heroContext`, `dmContext` read `ZONES`, `CITY`, `partyMates`, `openProps`, `tableView`; the letter rule is a Fellowship rule |
| `tiers.js` | engine | landmarks, chapters, search | `onRecord` import from `history.js`; mark kinds and `LVL_BAND` |
| `table.js` | split | scene lifecycle, `PLAY`, holds, nudges, step mode, `tableView` | built-in kinds and their branches; imports `fellowship`, `council`, `moves`, `tableround`, `brain.askRelay`, `CLS`, `MOBS`, `CRYPT` |
| `tableround.js` | game | combat rounds and dice | none |
| `council.js` | split | propose, vote, resolve, hold are kit | `PROP_KINDS` crypt/raid, `unitDraft`, `musterCrypt`, `bond`, `lead_to`, reach |
| `dmagent.js` | split | seat, notes, call log, turn record, narrate caps, `dmAct` dispatch | `dm_status`, `pileOn`, levers, Fellowship views, `ZONES`, `FAC`, `MOBS` |
| `staged.js` | split | staging protocol, table calls with `dmMs`, scripted fill | kinds built from `BESTIARY`, `buildEncounter`, `TRAPS`, levers |
| `dmfocus.js` | game | the players-first provider for Eldmoor | none |
| `campaign.js` | engine | campaign Markdown parser | `WORLD_ID` import -> parameter |
| `behavior.js` | split | watch scaffold, mind share, anomaly hold-back | digest content, `dmFocus`, `playerSeats` import |
| `brain.js` | split | `askRelay`, Mind entries, settle, offline, provider tags | `snapshotFor`, `SCRIPTED`, `townZone`, `brainFight`, `brainLine` |
| `throttle.js`, `lang.js` | engine | request throttle, language check | none |
| `talk.js` | game | NPC conversations | the no-repeat / met check (`heardLines`, `metNames`) is kit-worthy later |
| `reach.js`, `chat.js` | game | hearing ranges, speech | `agentLine` (the AGENT tag on a line) is kit |
| `fellowship.js`, `memory.js`, `persona.js`, `questlog.js`, `lore.js`, `crawl.js` and the world sim | game | content | none |

### 3.3 `src/data/` and `src/ui/`

- `player-tools.js`, `dm-tools.js`: game tables; the kit tools in 2.2 and 2.8 move out and are appended.
- `prompts.js`: game (decision kinds and voices); its `cleanText`/`cleanReason` helpers are kit.
- `src/ui/player-bridge.js`, `rungate.js`, `runalert.js`, `runners.js`, `frames.js`, `dmturns.js`: watcher
  widgets. Kit in spirit, but they import `src/sim/index.js` and the page layout. Step 2 leaves them in place
  and points their imports at `agentkit/`; extracting a UI kit waits for a second game with a browser host.

## 4. Coupling points that block a clean move

1. **Tool tables imported by the transport.** `relay-mcp.mjs` (`buildMcp`, `buildDmMcp`), `local-agent.mjs`
   (default `PLAYER_TOOLS` in `ollamaTools`, `cleanArgs`, `actionCatalogue`, `parseTextCall`, `localTurn`),
   `player.js` (`TOOL_META`). Cut: pass the table in; defaults come from the adapter.
2. **One state object `S`.** `notify.js` (`clockStr`), `reflect.js` (`S.gameMin`), `pace.js`, `notebook.js`,
   `tiers.js`, `player-host.js` (`S.agents.find`), `runlink.js` is clean. Cut: a kit `world` handle
   (`clock`, `seatById`) set once by the adapter, like `setRunnerLinks`.
3. **Kit logic inside game modules.** `playerAct` (envelope) shares a file with the game tools; `table.js`
   mixes the lifecycle with combat; `council.js` mixes votes with Crypt drafts; `dmagent.js` mixes notes with
   levers. Cut: move the envelope or lifecycle out, keep the content behind registries.
4. **Context for relevance.** `notebook.js` `heroContext`/`dmContext` and `resolveAbout` know towns, regions
   and parties. Cut: `adapter.memoryContext(seat)` -> `{names, places, refs}`.
5. **Prompt text in runners.** `agent-player.mjs` `systemPrompt`, `dm-agent.mjs` orders, `pacing.mjs`
   `briefText`, `local-agent.mjs` `LOCAL_RULES`. Cut: a `prompts` object in the Node-side adapter
   (`src/game/runner-prompts.mjs`), loaded by path from a `--game` flag or `AGENTKIT_GAME`.
6. **GM focus read by field name.** `dm-agent.mjs` `fellowNow`, `eventDue` read `fellowship_needs`,
   `fellowship_change`. Cut: `dm_status` carries a kit `players_first {summary, items, quiet, signature}`;
   the Eldmoor fields stay as aliases.
7. **Runner kinds name scripts.** `runners.mjs` `RUNNER_KINDS` and `agent-sessions.mjs` `DM_RUNNER_KIND`.
   Cut: kinds come from the adapter's runner config (script, defaults, caps, seats).
8. **Names in the wire protocol.** `X-Eldmoor-Hero/Role/Runner`, `hero` in `/play/*` bodies, `PLAY_HERO`,
   `ELDMOOR_SUPERVISED`, `ELDMOOR_RUNNER_KEY`, MCP server names `eldmoor-player`/`eldmoor-dm`. Cut: accept
   `X-Agentkit-Seat` and `seat` alongside the old names; never drop the old ones while Eldmoor uses them.
9. **Side-effect registration.** `crawl.js:154` and `staged.js:361` call `setSceneKind` at import; `tiers.js`
   gets `setChapterWriter` from `brain.js`; `table.js` gets `setProposeHook` into `council.js`. Import order
   decides `SCENE_KINDS` order. Cut: one `registerEldmoor()` in `src/sim/index.js` that registers in today's
   order.
10. **Two-way imports between kit and game.** `table.js` <-> `council.js` (hooks both ways), `pace.js` ->
    `table.js` -> `brain.js`, `behavior.js` -> `player.js`, `behavior-log.mjs` -> `local-agent.mjs`. Cut
    each with the registry or a parameter before moving either side.

## 5. Carve order (step 2, children of #290)

Rules for every child: Eldmoor keeps working at each merge; old paths keep a one-line re-export shim until
the last child removes them; `npm run sim` and the seeded hashes do not move; one child at a time, alone,
while no other agent edits the files it names (#290 Timing). Sizes: S under a day of agent time, M one to two.

| # | Child | Size | Files |
| --- | --- | --- | --- |
| K1 | Kit skeleton and the adapter contract | S | new `agentkit/README.md`, `agentkit/adapter.js` (JSDoc types, `checkAdapter()`), new `src/game/adapter.js` wrapping today's exports; `scripts/kitcheck.mjs` checks the Eldmoor adapter is complete |
| K2 | Move the clean Node leaves | S | `scripts/providers/*`, `warmup.mjs`, `agent-chat.mjs`, `behavior-turn.mjs`, `agent-sessions.mjs` -> `agentkit/node/`; shims at old paths |
| K3 | Relay and MCP from the adapter | M | `relay-mcp.mjs`, `mcp-stdio.mjs`, `relay.mjs` (tool tables, instructions, header aliases, `/decide` kinds from the adapter) |
| K4 | Runner core | M | `pacing.mjs`, `local-agent.mjs`, `runners.mjs`, `behavior-log.mjs`; new `src/game/runner-prompts.mjs`; `agent-player.mjs`, `fellowship.mjs`, `dm-agent.mjs` become thin configs |
| K5 | Adapter 2, phase 1: the dice game without scenes | M | new `games/dice/` (adapter, tools, a 30-line world), `scripts/kitcheck.mjs` runs relay + host + a mock-Ollama runner for two seats; added to CI |
| K6 | Sim-side kit modules | M | `notify.js`, `runlink.js`, `reflect.js`, `player-host.js`, `pace.js` (kit half), `notebook.js` and `tiers.js` (kit halves) -> `agentkit/sim/`; `player.js` envelope out of `playerAct` |
| K7 | Table framework and votes | M | `table.js` lifecycle -> `agentkit/sim/table.js`; Eldmoor built-in kinds -> `src/sim/scenes.js` via `setSceneKind`; `council.js` vote core |
| K8 | GM seat | M | `dmagent.js`, `staged.js` (protocol halves), `dm-tools.js` kit tools, `campaign.js`, `dm-agent.mjs` players-first field |
| K9 | Adapter 2, phase 2: GM and scenes | S | `games/dice/`: a GM seat with notes and `narrate`, one `all` scene (bids) and one `turns` scene (rolls); `kitcheck` covers waits, reflex, slot-order resolution |
| K10 | Checks on both adapters | S | `channelcheck.mjs` (adapter `plantSecrets`), `behavior-report.mjs`, `mind-compare.mjs`, `memory-mirror.mjs`; drop the shims |

Why this order: the leaves with no game imports go first (K2), so the risky files (K3, K4, K6, K7) each move
with a working kit under them. Adapter 2 comes in at K5, as soon as a seat can be played over the relay,
so every later child is proven on two games, not one. The hot sim files (K6, K7) come late, when the board is
quiet.

Adapter 2 (proposal): a two-seat dice game run by a GM ("Liar's Dice at an inn"). Each seat has
`look`, `bid`, `call`, `say`, `wait` and the kit tools; the GM has `table_status`, `narrate`, `set_stakes`.
State fits in one object; the clock is one game minute per real tick; no art, no browser. `kitcheck` runs it
headless with `scripts/mock-ollama.mjs` in under 20 seconds.

Step 3 (later, not sized here): `agentkit/` to its own package or repo when the owner starts the next game.

## 6. Risks

### Hot files

`player.js` (700 lines), `table.js`, `relay-mcp.mjs`, `runners.mjs`, `pacing.mjs`, `local-agent.mjs`,
`agent-player.mjs`, `fellowship.mjs`, `dm-agent.mjs`, `dmagent.js`, `council.js` are edited by most
brain-builder and ai-designer PRs (#240, #276, #285 in the last weeks). A move under an open PR turns it into
a rewrite. Mitigation: each child names its files, pm holds other work on them while it runs, moves are
`git mv` plus shims in their own commit so blame follows, and logic changes never share a commit with a move.

### Determinism

- `npm run sim` never loads the agent layer, but it does import `table.js`, `council.js`, `notify.js`,
  `reflect.js` and `tiers.js` through `src/sim/index.js`. Gate: the `npm run sim -- 60` summary and the
  seeded hashes (`node scripts/professioncheck.mjs --hash`, `CRAWL_BASELINE_HASH` in `crawlcheck`) equal
  `main` before and after every child.
- Registration order (coupling 9) decides `SCENE_KINDS` and the scene iteration order; keep it.
- `table.js` keeps a private LCG for flavour lines; it moves with the lifecycle or stays with the game, never
  shared with `core/rng.js`.
- `all` scenes resolve in Fellowship slot order, never arrival order; the kit must take `order(seats)` from
  the adapter.
- Kit modules stay RNG-free and out of `step()` except the hooks the game calls today (`tableTick`,
  `tableHold`, `councilTick`, `playerUpd`).

### Save formats and files on disk

- Step 2 keeps every field name in 2.10. Namespacing them (`a.kit.*`) would need a migration in `save.js`
  and break older saves in `localStorage`; propose it, if at all, as its own child with `npm run savecheck`.
- Session files `logs/agents/<id>.json`, `logs/agents/dm.json`, the mirror tree `logs/agents/<world>/`,
  `logs/behavior/<world>/*.jsonl` (the reviewer reads them) and `logs/runners/active.json` keep their paths
  and fields. `AGENT_LOGS` stays the override.
- Wire names (coupling 8) stay accepted; the page and runners from before a child must still work against
  the relay after it, since `up.mjs` restarts the relay alone.

### Other

- CI time: K5 and K9 add one check; keep it under 30 s with the mock providers.
- Two package roots: `agentkit/` must not import `src/` (checked by `kitcheck` with a grep), or the boundary
  erodes on the first busy week.

## 7. Open questions for the owner

1. **Next game's clock.** Real-time with a game clock like Eldmoor, or turn-based? Pacing, autopilot and the
   1x drop assume a running clock; a turn-based game would only need decision points and scenes.
2. **Browser or Node only.** Should the kit ship the watcher widgets (Agent tab, frames, start gate, runner
   alert), or does the next game get a Node host and logs first?
3. **Package shape.** In-repo `agentkit/` folder for step 2 (proposed), then npm package or separate repo at
   step 3? Which name: `agentkit` or something of its own?
4. **Rules that become kit defaults.** Hardcore one life, "party seats always agent-played", "the GM serves
   the players first" and "in-game channels only": engine defaults every game inherits, or Eldmoor rules a
   game may turn off?
5. **The GM.** Exactly one GM seat per game, optional GM, or several (a narrator and a referee)?
6. **Providers.** Keep the Agent SDK for Claude seats in every game, or one tool loop (`local-agent.mjs`) for
   all providers so a game needs no SDK?
7. **Adapter 2.** Is Liar's Dice with a GM a good test game, or do you have a first real second game in mind
   that should be adapter 2 instead?
8. **Freeze window.** Steps K3-K8 need the brain and ai files quiet. When can the board pause for them
   (about 6-9 agent days in all)?
9. **Wire rename.** Accept `X-Agentkit-*` and `seat` alongside `X-Eldmoor-*` and `hero` forever, or retire the
   old names after a release?
