# Eldmoor

An 8-bit "ant farm" MMO simulation inspired by classic MMOs. The player does not
control anyone: AI heroes from two factions level up, quest, trade, duel, hold
grudges, run a dungeon and raid a world boss on their own, and the player watches.

## Hard rules

- **Original IP only.** Everything is WoW-*inspired*, never WoW content. No
  Blizzard names, races, classes-as-branded, zones, characters, items, maps,
  sprites or sounds. Generic fantasy terms (warrior, mage, orc-like brutes) are
  fine; Azeroth, Horde, Alliance, Stormwind, Arthas etc. are not.
- **Hardcore.** Every hero has one life. Death is permanent; a fresh level-1
  recruit of the same class and guild replaces them.
- **No build step required for the art.** All terrain and sprites are generated
  in code (pixel arrays and procedural textures). No image assets yet.
- **Built to scale.** The world will grow 20-30x with several races and home
  towns per faction (see the scaling epic on GitHub). Never hard-code the number
  of zones, factions, cities or races; loop over the tables. Never assume a zone
  is a vertical band or where it sits on the map; ask the world module
  (`zoneAt`, `zoneFor`, `CITY`). Keep entity scans in one helper each so they can
  move to a spatial index.
- After any change to simulation logic, run `npm run sim` (and `npm run sim -- 120`
  for balance work) and check the summary still looks sane.

## Agent team

Dedicated subagents live in `.claude/agents/`. Delegate to them by area:

| Agent | Owns |
| --- | --- |
| `world-builder` | Map, zones, terrain, cities, dungeons, landmarks, world events |
| `character-builder` | Classes, factions, guilds, names, hero sprites, stats, traits |
| `creature-designer` | Monsters, bosses, loot, epics, auction-house economy |
| `ai-designer` | Hero behavior: states, questing, PvP, grudges, dungeons, raids |
| `balance-tester` | Read-only headless sim runs and balance reports |
| `lore-keeper` | `docs/LORE.md`, flavor text, originality checks |
| `brain-builder` | Model-played heroes: decision-policy interface, local relay, prompts, fallbacks; generated narrator and chatter modes |
| `pm` | Backlog triage, issues and labels, priority order, briefs for next pickups, board snapshot and status summaries (no code, no merges, no dispatch) |

Models per agent (set in each agent's frontmatter): Opus for `ai-designer` and `brain-builder` (shared-file behaviour and runtime model code), Sonnet for `world-builder`, `creature-designer`, `character-builder`, `lore-keeper`, `balance-tester` (bounded work checked by sims and review), Haiku for `pm` (triage and board). Quick read-only checks (a short lore pass, a board sync) may run on Haiku by overriding `model` on the call; full originality reviews stay on Sonnet. Escalate a single task to Opus by overriding `model` on the Agent call; use Fable only for hard architecture.

For a feature that spans areas (for example a new zone with new monsters), plan it,
hand each part to its owner, then have `lore-keeper` check names and
`balance-tester` check the numbers. `docs/LORE.md` is the shared canon.

## Working in parallel (agents and people)

The repo is set up so several agents can work at once without stepping on each
other. The rules:

- **One task, one branch, one area.** Branch from `main` as
  `<area>/<short-name>` (for example `world/hoarfell-weather`). Edit only files
  your area owns (see the ownership table below). If you must touch another
  area's file, keep the edit minimal and list it under "Out-of-area edits" in
  the PR.
- **Parallel work uses worktrees.** `git worktree add ../eldmoor-<area> -b <area>/<name>`
  gives each agent its own checkout; never have two agents editing one working
  tree.
- **Small PRs, always green.** Every PR runs `npm run build` and a headless sim in
  CI. Paste the `npm run sim` summary in the PR body. Balance-sensitive changes
  also include `npm run sim -- 120`.
- **Names go through lore.** Anything newly named (zone, creature, item, NPC,
  guild, quest) is added to `docs/LORE.md` in the same PR, and `lore-keeper`
  checks originality before merge.
- **Numbers go through balance.** Changes to stats, mobs, bosses, XP or AI get a
  `balance-tester` report before merge.
- **Issues are the queue.** Work is tracked as GitHub issues labelled
  `area:<area>`; an issue labelled `agent-ready` is scoped enough to hand to the
  owning agent with no further questions. Pick one, branch, PR, close it.
- **Shared data tables are append-only during a feature.** Adding a row to
  `MOBS`, `EPICS`, `GOODS`, `CLS` or a zone list is fine in parallel; renaming or
  reordering existing rows is a coordinated change done alone on `main`.

## Commands

- `npm install` once, then `npm run dev` to play at http://localhost:5173
- `npm run sim [minutes]`: headless run of the real game code in Node, prints
  levels, deaths, honor, guild dungeon results and boss state.
- `npm run build`: static build into `dist/`.
- Worlds: Eldmoor (80x50) by default; `?world=stepping` in the browser or `ELDMOOR_WORLD=stepping` in Node selects the 160x100 Stepping Lands test continent (saves are kept per world).
- `npm run worldcheck`: builds the world specs headlessly and checks the Eldmoor map hash.
- `npm run savecheck`: snapshot/restore round trip of the sim state.
- `npm run playcheck`, `npm run play-headless`, `npm run agent`, `npm run mcp`: the agent player (see below).
- `npm run fellowship`, `npm run tablecheck`: the Fellowship played by agents, and Table mode (see below).

## Agent player

AI agents can play heroes end to end (issues #75, #93), several side by side, one agent per
hero: each looks around, walks, fights, takes adventures, answers scene choices and keeps a
journal, through MCP tools (the list is `src/data/player-tools.js`; the game side is
`src/sim/player.js`). The hero stays a hero: one life, sight limits, the same dice; reflexes
(defend, flee below 15% HP, go home with a full bag) keep it alive while the agent thinks or
is silent, and scene choices time out to the scripted branch, so the world never waits.

- With the browser: `npm run relay` (or `npm run relay -- --play-only` without a key),
  `npm run dev`, select a hero and press **Agent** on its card, for as many heroes as you
  like (the page connects to `ws://127.0.0.1:8787/play` and serves them all; the Agent tab
  shows tool calls, narration, the journal and the agent's link). Then one terminal per hero:
  `npm run agent -- --hero <name|id>` (Claude Agent SDK, `claude-sonnet-5-5` by default,
  `AGENT_MODEL` to change; `--max-turns 20 --budget 1.00` are the default caps per runner;
  cost line per turn). Without `--hero` the runner lists the agent-played heroes and takes
  the first living one with no runner, or says none is free.
- Headless: `npm run play-headless -- --warm 20 --agents 2` (a Node world on port 8789 with
  the top Concord and Warband heroes agent-played, or `--hero Ann,Bo`; saved to
  `logs/agent-world.json`, `--resume` to continue), then in two terminals
  `npm run agent -- --url http://127.0.0.1:8789 --hero <first>` and `... --hero <second>`.
- One runner per hero: a runner claims its hero at the relay (`POST /play/claim`, refreshed
  every 10 s, released on exit; a second runner for a held hero is refused) and names it on
  every call (`X-Eldmoor-Hero: <id>` on the MCP connection, `hero` on `/play/*`), so its tools
  only touch that hero. Link state per hero, in the Agent tab and the Minds panel:
  **connected** (calling tools), **waiting** (a runner holds it but is thinking or between
  turns), **no runner**.
- Sessions: one file per hero, `logs/agents/<heroId>.json` (gitignored), with the Agent SDK
  session id, system prompt, turns, cost and the hero's runner settings (`runner: {provider,
  model, effort}`, default `anthropic` + `claude-sonnet-5-5`; flags override, then saved, then
  env), so each hero can keep its own mind; only `anthropic` runs today (Mixed minds will add
  others; the relay already routes by hero id only). The next run for that hero resumes it. Runners
  never write another hero's file. A file whose hero name no longer matches (a new world
  reused the id) and the old session on `--new` are moved to `logs/agents/old/`, never
  overwritten. The single `logs/agent-session.json` of #75 migrates on first run.
- Other MCP clients: streamable HTTP at `http://127.0.0.1:8787/mcp` (or `:8789/mcp`
  headless), stateless, POST only, with the `X-Eldmoor-Hero` header or `?hero=<id>`; or stdio
  with `npm run -s mcp` (forwards to `PLAY_URL`, `PLAY_HERO=<id>` picks the hero). Plain JSON
  without MCP: `POST /play/call {tool, args, hero}`; `GET /play/health` lists the agent heroes
  and their links. A call that names no hero goes to the first living agent hero (the old
  single-hero path). Only localhost, no browser origins.
- `npm run playcheck`: a scripted mock agent plays through town, a job, a choice, a fight,
  the journal and a save/restore, proves a silent agent never stalls the world, and runs two
  mock agents on two heroes at once (routing, claims, links, the browser bridge, per-hero
  session files). The mock agent's waits drive game time, so it depends on the seed only.

## Fellowship (agents and Table mode)

The Fellowship (#68) is five heroes (Tank, Healer, three DPS) who are the story. Its panel's
**Minds** button cycles scripted -> relay -> agents. With **agents** every member is
agent-played (a replacement after a death is too) and `npm run fellowship` plays all five,
one Agent SDK session per member.

- Browser: `npm run relay` (the brain relay, port 8787; it also serves the agents' MCP tools),
  `npm run dev` (5173), found a Fellowship, set Minds to agents, then
  `npm run fellowship -- --max-turns 6 --budget 2.00`.
- Headless: `node scripts/play-headless.mjs --fellowship --port 8790 --warm 20 [--no-relay]`
  then `npm run fellowship -- --url http://127.0.0.1:8790 --max-turns 2 --budget 0.50`.
- The runner reuses the per-hero sessions (`logs/agents/<heroId>.json`, resumed next run,
  `--new` to start over), runner settings and claims of `npm run agent`; one overall
  `--budget`, `--max-turns` per member, `--cadence S` between turns outside scenes (a scene
  starts the member's turn at once), `--follower-model claude-haiku-5-5` for members other
  than the leader between scenes. Combined log `logs/fellowship.log`, per-run cost per member
  in `logs/fellowship-runs.jsonl`.
- Party tools (`src/data/player-tools.js`, `src/sim/council.js`): `party_say`/`party_read`
  (party channel, Chat tab and bubble), `propose`/`vote` (job, crypt, raid, split, other; the
  leader settles it: majority, leader breaks ties, silent members vote by reflex at the
  timeout), leader-only `lead_to`, `leave_party` (splits off for 6 game hours, costs bonds).
  A Crypt group or raid takes the whole Fellowship or none of it; an agent-played Fellowship
  is asked first (a `crypt`/`raid` proposal).
- Table mode (`src/sim/table.js`, banner `src/ui/table.js`): Crypt entry and inner chamber,
  Kragmaw, elite/named foes, enemy ambushes, a member below 25% HP, DM checks and choice
  scenes on their adventures, and proposals open a scene. At 1x `step()` pauses the world
  (only the scene runs), the DM frames it, members act in initiative order (Reflex with gear)
  with `scene_act`; an agent has `TABLE.turnMs` (7 s) per turn, then its reflex acts; scripted
  members act at once. At 3x/8x scenes resolve instantly with a summary. The View group's
  **Table: Auto/Off** switch (Off = Watch mode) never pauses. `npm run tablecheck` proves a
  silent agent never stalls a scene, votes, `lead_to`, the all-or-none Crypt draft and
  determinism without a Fellowship.

## Layout

- `index.html`: page shell and side panels. `src/style.css`: dark single-theme
  arcade look; Press Start 2P for labels, VT323 for body text.
- `src/main.js`: browser entry only. Calls `init()`, builds the terrain canvas,
  creates the renderer and panels, runs the frame loop (1 real second at 1x =
  6 game minutes).
- `src/core/rng.js`: random helpers, hash, value noise, fbm.
- `src/world/` (world-builder): `tiles.js` map size, tile ids, speeds;
  `spec.js` the world as data: `ELDMOOR` (size, seeded boundary curves,
  regions with level bands, biomes and masks, the river, towns Highgate
  (Concord) and Grimhold (Warband), landmarks (Kragmaw's lair, the Sunken
  Crypt), roads, lights, spawn exclusions, labels) plus the tiny `TESTWORLD`
  fixture; `gen.js` `buildWorld(spec)` paints biomes, river, town rects,
  landmarks and roads (polylines, or A* `routeRoad` between named endpoints
  that bridges rivers) and derives `ZONES`, `CITY`, `LAIR`, `CRYPT`, the
  `zoneFor` level ladder from region bands, `ZPTS` spawn points, `LIGHTS` and
  `LABELS`; `map.js` builds `ELDMOOR` once and re-exports it under the old
  names (`tiles`, `zone`, `I`, `riverX`, `z2X`, `hoarY`, ...). `npm run
  worldcheck` builds both specs and fails if the Eldmoor map drifts from its
  snapshot hashes.
- `src/data/` (pure tables, no logic): `factions.js` FAC, guild roster, names
  (character-builder); `classes.js` CLS (character-builder); `mobs.js` MOBS and
  COUNTS (creature-designer); `items.js` EPICS, BOSS_EPICS, DG_EPICS, GOODS and
  `price` (creature-designer).
- `src/sim/` (DOM-free; ai-designer owns behaviour, creature-designer owns boss
  numbers): `state.js` the single `S` state object and game clock;
  `chronicle.js` `log(...parts)` and `onLog`; `effects.js` pop/bolt;
  `heroes.js` stat formulas, quests, movement, combat, death and the `updAgent`
  state machine (`town`, `travel`, `hunt`, `fight`, `return`, `ghost`, `duel`,
  `assist`, `dungeon`, `raid`, `dead`); `mobs.js` spawning and mob AI;
  `boss.js` the Kragmaw fight and raid muster; `pvp.js` duels, nemesis hunts,
  assists; `dungeon.js` Sunken Crypt runs; `market.js` auction-house prices;
  `history.js` `record(a, ...parts)` per-hero event log for the dossier Log tab;
  `levers.js` the DM's world levers: a validated registry (`pull(name, params, {by, reason})`)
  with limits, cooldowns and DM log entries for people, places, danger/cleared areas, region
  conditions, price shocks, hooks and named/custom foes, plus the hooks the world reads them
  through (state on `S.levers`, `S.places`, `S.marks`, `S.conditions`, `S.wanderers`;
  drawn by `src/render/places.js`; `npm run levercheck`);
  `index.js` `init()` and `step(dt)`; `fellowship.js` the Fellowship (#68): five fixed
  roles (Tank, Healer, three DPS), founding, muster, hardcore replacement, campaign log,
  `fellowshipMembers()` in slot order; `persona.js` persona sheets and backstories from
  sim facts (scripted, or enriched once through the relay) and `fellowCard` for prompts;
  `memory.js` per-member recent memories, long-term summary and companion stances;
  `council.js` party chat, proposals and votes, `lead_to`, splitting off and the all-or-none
  Crypt/raid draft; `table.js` Table mode scenes; `notify.js` events for agent-played heroes.
- `src/render/`: `sprites.js` pixel-string sprites and `heroSprite`;
  `terrain.js` per-pixel tile textures into an offscreen canvas;
  `draw.js` the camera object `cam`, entities sorted by y, effects, day/night
  overlay with torch light, labels at constant CSS size.
- `src/ui/`: `panels.js` hero card, factions, chronicle, graveyard, guilds,
  top heroes, auction house, clock; `controls.js` speed, view (incl. Follow Fellowship)
  and selection; `fellowship.js` the Fellowship panel (founding, roster, sheet editor,
  campaign log), the Memory tab and the Chronicle's "Fellowship only" filter; `table.js` the
  Table mode banner and the View group's Table switch. Fellowship-first UI (#94):
  `frames.js` party frames above the map, `sheet.js` the side-by-side sheet overlay,
  `layout.js` folds the world panels into a "World" group while a Fellowship exists,
  `mindctl.js` per-member mind control and the Developer toggle (with a Fellowship, AI/Agent
  buttons show only on members unless Developer is on).
- `scripts/headless.mjs`: imports `src/sim/index.js` directly (no DOM stubs),
  steps the world and prints a summary from `S`.

Data flow: sim writes `S` and emits chronicle and market events; render reads
`S` and owns `cam` (view mode and selected hero); UI reads both. `S.pinned` is
the followed hero, whose grave is never recycled. Sim modules never import from
render or ui, so the headless harness stays stub-free.

## Tuning knobs

- XP curve `xpNeed`, caution thresholds (hunt retreat at 45% HP, flee at 22%):
  `src/sim/heroes.js`. Hero combat totals (Health, Attack, Defense, Crit, Speed) and their
  level terms: `combatStats` in `src/sim/stats.js`; item armor/damage rates and properties:
  `src/data/items.js`. Class table `CLS`: `src/data/classes.js`.
- Mob stats (`maxhp: 25 + lvl*16`, hit `3 + lvl*2`), aggro and wander: `src/sim/mobs.js`.
- Boss: `maxhp` 9000 in `src/sim/state.js`; hit 55-85 every 1.6s, breath every
  7s, raids need level 14+ heroes, 5+ of them or 4 with average gear 9+; raiders
  break off below 15% HP and a failed raid cools down 240s: `src/sim/boss.js`,
  `RAID_FLEE` in `src/sim/heroes.js`.
- Dungeon success: the `pw` formula in `src/sim/dungeon.js`; a wipe kills 55% of the party.
- PvP: chance duels 4% x boldness, level gap 2, range 3 tiles; nemesis spot cooldown 45s; guild assist 20%; duellers yield below 30% HP; only fallen heroes of level 12+ pass the grudge to the whole guild (lesser deaths bind their party): `src/sim/pvp.js`, `GUILD_GRUDGE_LVL` in `src/sim/heroes.js`.

## Known state

- In a 120-minute headless run from level 1 (after the rebalance and item stats), about 26 deaths per hour, roughly 40% PvP; median living level 11; 9 veterans at 14+. Kragmaw dies in most runs with 0-4 raid deaths. Late-game (240 min) PvP among level 11+ veterans climbs back toward 50-60% of deaths.
- The world auto-saves to localStorage every game-hour and on tab close, and restores on reload; Export/Import move it as JSON (`src/sim/save.js`, `src/ui/save.js`, `npm run savecheck`).

## Roadmap ideas

1. Done: `main.js` is split into `world`, `data`, `sim`, `render`, `ui` with a
   DOM-free sim core.
2. Done: save and load (localStorage auto-save, JSON export/import).
3. Rebalance hardcore: fewer pointless PvP deaths, a winnable Kragmaw.
4. More world: a second dungeon, rare elite mobs, world events, weather.
5. Smarter AI: parties that quest together, healers following tanks, heroes
   avoiding enemies far above their level, personality traits.
6. Watcher tools: hero biographies, a timeline of notable events, stats charts.
