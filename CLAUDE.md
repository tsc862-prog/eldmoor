# Eldmoor

An 8-bit "ant farm" MMO simulation inspired by classic MMOs. The player does not
control anyone: AI heroes from two factions level up, quest, trade, duel, hold
grudges, run a dungeon and raid a world boss on their own, and the player watches.

## Hard rules

- **Own world, borrowed words are fine.** This is a personal project, so copyright is not a concern.
  Generic fantasy names and ability or item names that also appear in other games (Ambush, Sanctuary,
  Bastion) are fine. Don't copy a franchise's distinctive proper nouns wholesale (Azeroth, Horde,
  Alliance, Stormwind, Arthas) or its maps, sprites and sounds; Eldmoor keeps its own places, peoples
  and characters. Prefer names that sound good over names that are merely unique.
- **Hardcore.** Every hero has one life. Death is permanent; a fresh level-1
  recruit of the same class and guild replaces them.
- **Every company member is always agent-played.** Every member of an agent company, the Fellowship included (and every replacement), is
  controlled by an agent at all times; there is no scripted or single-call AI mode for members. Between
  decisions a member may auto-play (autopilot: carry out the last order, follow the leader, reflexes such as
  defend, drink a potion, flee below 15% HP), but every decision belongs to its agent: votes, proposals,
  lead_to, Table scene choices, jobs, splitting off, what to say. A decision point waits for the agent
  (Table mode pauses the world at 1x); reflex choices are only a fallback when the runner is gone, and then
  the runner-stop alert pauses the world and asks the owner. Background heroes may be scripted.
- **The DM is always agent-played.** The DM seat is always held by an agent (#520): the setup page requires a DM mind, a
  world opens the seat from the first tick, an older save with a closed seat or a scripted-DM setup converts on load with a
  notice in the DM log, and there is no "no DM agent" mode. The scripted DM (`src/sim/dm.js`) is the world engine (boards,
  background adventures, encounters) and the DM's reflexes (`src/sim/dmreflex.js`, #561): it fills a bounded wait (a Table
  voice slot, a staged scene's outcome, session zero's frame, an arrival, a townsperson's answer) when the runner is slow,
  and every fill is logged. When the DM runner is gone the world pauses at the start gate and asks the owner (Resume anyway,
  Restart; #578), as for a member; reflexes answer only after the owner resumed. `npm run sim` and the seeded checks have no
  runner and fill at once, so their hashes do not move. Background heroes may still be scripted.
- **The DM serves the companies first, then the world.** ("Company" is the generic word; the Fellowship is the default five-place company and keeps its name.) The DM's priorities are the player's companies first, the Fellowship above all, then the overall game world, for the DM agent and the scripted world engine alike: each turn or refresh starts with where the companies are, their open threads and oaths, pending decisions and what would make their next game hours interesting; hooks, rumours, people, places and staged scenes go to their road first; world-shaping that does not touch them comes after, and only when nothing is pending for them. A share of every daily lever and staging limit is reserved for them. See "DM agent" below.
- **In-game channels only.** The DM and the players (company members, agent-played heroes)
  communicate only inside the game: in-game chat (say in earshot, party shouts in range, townsfolk, the
  DM's `narrate` and `npc_say`) and what their characters can see. Nobody messages anyone directly
  outside it. A hero's tools, runner prompts and brain snapshots never carry DM notes, the DM log,
  lever reasons, or another hero's journal, memories, persona, mind, narration or session; a claimed
  hero answers only its own runner; heroes have no DM tools and the DM no hero tools. The watcher
  (the owner's browser) still sees everything. See "In-game channels" below; `npm run channelcheck`.
- **Generated art, procedural fallback, no build step to play.** Art is generated images under `assets/`
  (PNGs plus `assets/index.json`, committed and served by Vite as static files) made offline by the Hugging Face
  pipeline in `scripts/art/` (#177); every asset has a procedural fallback (the pixel arrays and procedural
  textures in `src/render/`), so a missing or absent `assets/` never breaks a world and looks as before. The sim,
  the map and its hash, lighting, weather, effects and the minimap stay procedural; `HF_TOKEN` is read only by
  `scripts/art/gen.mjs`, never by the browser or the relay.
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
| `playtest-reviewer` | Reads DM and character behavior logs (runner logs, sessions, relay, `logs/behavior/`) after play and files evidenced issues (no code, no merges) |
| `ui-designer` | The watcher interface: layout, panels, dossier tabs, Fellowship panel and frames, Table banner, Agent/Mind/Chat tabs, setup page, styles, scrolling, phone width |
| `pixel-artist` | World graphics: terrain, tiles, sprites and animation, towns and landmarks, lighting, weather, effects, camera and draw order (`src/render/*`) |

Models per agent (set in each agent's frontmatter): Opus for `ai-designer`, `brain-builder`, `ui-designer` and `pixel-artist` (shared-file behaviour and runtime model code), Sonnet for `world-builder`, `creature-designer`, `character-builder`, `lore-keeper`, `balance-tester` (bounded work checked by sims and review), Haiku for `pm` (triage and board), Sonnet for `playtest-reviewer`. Quick read-only checks (a short lore pass, a board sync) may run on Haiku by overriding `model` on the call; full originality reviews stay on Sonnet. Escalate a single task to Opus by overriding `model` on the Agent call; use Fable only for hard architecture.

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
- Title screen (`src/ui/title.js`): the page opens on Continue (with a line on the save), New world (the setup page), Load from file and the map choice; no world is built or restored until a choice. `?continue=1` (or `?skip-title=1`) boots straight in as before; a queued New World setup and a Load/Import reload skip it too.
- New worlds (#111): `init()` founds the default Fellowship (level 1, home town, Minds scripted) and starts the other heroes at levels 1-15 in fitting zones (`src/sim/opening.js`, `START_BANDS`). `ELDMOOR_FELLOWSHIP=0` in Node, `?fellowship=0` in the browser or `init({fellowship:false})` keeps the old all-level-1 start for balance baselines; checks that found their own Fellowship use it.
- `npm run hashcheck` (#573, `scripts/hashcheck.mjs`): the one source of the seeded hashes PRs quote (professioncheck with and without the Fellowship, tablecheck --hash and --hash-talk, crawlcheck, dmcheck seat closed and open, focuscheck, the no-company world, the Eldmoor map). It runs them here and on `git archive origin/main` extracted to a temp dir (never a worktree) and prints both side by side; exit 2 when one moved. The CI job `hash-guard` comments that table on every PR and fails when a hash moved unless the PR has the label `hash-change-ok` (add the label, then re-run the job). Quote its table in PRs, not hand-run hashes.
- `npm run rulescheck` (#573): src/sim, src/world and src/data never import src/render or src/ui; no zone, faction or town name literals outside src/data and src/world (known ones in `scripts/rulescheck.allow.json`, with a reason); the append-only tables (MOBS, EPICS, GOODS, CLS, the world specs' regions and towns, ...) keep every existing row in place against origin/main; every `scripts/*check.mjs` with an npm script is a step in ci.yml. CI also runs on `merge_group` for GitHub's merge queue.
- `npm run worldcheck`: builds the world specs headlessly and checks the Eldmoor map hash.
- `npm run savecheck`: snapshot/restore round trip of the sim state.
- `npm run invcheck`: the pack, consumables, quest items, the bag-to-pack save migration and determinism.
- `npm run playcheck`, `npm run play-headless`, `npm run agent`, `npm run mcp`: the agent player (see below).
- `npm run localcheck`: the local agent runner against a mock Ollama (see "Model providers"), and runner
  pacing (turns per game hour on a quiet world, a notification starts a turn at once, the failure stop, a lazy
  model re-prompted and stopped, the scripted takeover of an idle hero).
- `npm run scenewaitcheck`: Table scene waits (#515): the Ollama queue puts scene answers first, a free turn gives way to its
  scene, `table_waits`/`waited_s`/`{queued}`/`scene-missed`, and five slow mock members answering an everyone-at-once scene in time.
- `npm run openaicheck`: the OpenAI provider against a mock OpenAI server (adapter, relay, agent loop, runner).
- `npm run fellowship`, `npm run tablecheck`: the Fellowship played by agents, and Table mode (see below).
- `npm run crawlcheck`: the dungeon crawl (#65, see "Dungeon crawl" below): rooms as spec data, a Fellowship crawl opening room scenes in order, retreat, driven back and wipe at the table's dice, save mid-crawl, 8x, seeded determinism, and a seeded background world that repeats (`CRAWL_BASELINE_HASH=<hash from main>` asserts it equals main's).
- `npm run movecheck`: class abilities (#81): `src/data/moves.js` MOVES/PASSIVES (3 active abilities with a cooldown in seconds and in rounds, 2 passives per class), the one resolver `useMove` in `src/sim/moves.js` for real-time and Table rounds, timed effects and passives in `src/sim/eff.js`, the `use_ability` agent tool, and the Abilities block (`src/ui/abilities.js`) on the Stats tab and Fellowship sheet.
- `npm run professioncheck`: professions (#254, epic #238), the table `src/data/professions.js` (`PROF`, `PROF_IDS`, `MAX_PROF` 2, `SKILL_MAX` 100; nine ids: herbalism, mining, skinning, fishing = `gather`; alchemy, smithing, leatherworking, cooking, scribing = `craft`; append-only) and the skill model `src/sim/professions.js`. A hero's trades are `a.profs = [{id, skill}]` (optional; absent reads as `[]`; not `a.prof`, which is the ability skills of `abilities.js`). API: `professionsOf(a)` -> `[{id,name,kind,skill}]`, `skillOf(a,id)` (whole 0-100, 0 = not held), `hasProfession`, `canLearn(a,id)` / `learn(a,id)` -> `{ok, why?}` (refuses unknown, duplicate, third; starts at 1), `gainSkill(a,id,amount)` -> `{ok, skill, gained, up}` (amount in points, fractions allowed, pure function of the amount, caps at 100, no RNG), `skillBand(skill)` 0-4, `normalizeProfs(a)` (restore hook in `save.js`). Learning and gathering are wired by #257 (`src/sim/gather.js`, below); `node scripts/professioncheck.mjs --hash` prints the seeded world hash used to prove the scripted world is unchanged.
- `npm run gathercheck`: gathering (#257, epic #238), `src/sim/gather.js`. Agent tools (rows in `player-tools.js`, handlers in `player.js`): `recipes {profession?}` (your professions, skill and rank, what each gathers or makes, materials with the skill each needs, recipes with inputs carried, what is still learnable), `learn_profession {id}` (id, name or alias; at a trainer in a friendly town; a duplicate or a third is refused, naming `unlearn_profession`), `unlearn_profession {id}` (skill lost), `nodes {kind?}` (spots in sight: id, tiles, direction, ready or spent, whether you can work it) and `gather {node?}` (a node id or kind in sight; queues a `gather` command that walks there and works it `GATHER.MIN` 20 game minutes, then a d100 check against the material's band: success adds the node's best material at or below its band to the pack as a trade-good stack and spends the node, a miss costs the time; skill rises either way; out of sight, spent, too hard (more than one band above you), no trade or a full pack are refused with the way on). Gathered materials sell at the auction house (`sellLoot`/`sellEntry` treat a MATERIALS id like a GOODS one; MATERIALS supply decays in `market.js` to a floor of 6 and is saved as `MATS`). Scripted heroes take up one gathering trade at level 3 by class and trait (`pickTrade`, no RNG) and, while hunting (still state `hunt`, `a.gathering`), work a ready node of their trade within `GATHER.SPOT` 10 tiles at most once per `GATHER.GAP` 300 game minutes (about 0.7 tries a hero a game day); agent-played heroes never learn or gather by script. `S.gatherStats` counts tries, hauls, units and trades learned. Changes the seeded scripted world.
- `npm run setupcheck`, `npm run setupsmoke`: the New World setup (`src/sim/setup.js`, `src/ui/setup.js`, #133): New world opens a page to choose the Fellowship (class, name, people, mind per place) and the DM, then builds the world seeded (`init({setup})`) with agent members agent-played from the first tick and starts their runners through the relay. Setup v2 (#453): `{mode:'together'|'apart', fac, heroes:[{cls, fac, mind, start?:{town, region}, group?}]}`, 1-5 heroes; together (the default, permanently) is the five places in one hall and builds exactly the world of before; apart founds one company per `group` (a solo per hero with none) at its start town, level 1 or seasoned to `start.region`'s band low; a v1 setup (`slots`) migrates to together (`cleanSetup`/`asV2`); shape presets `classic`, `five-solos`, `pairs-and-solo`, `solo` beside the mind presets; `planRunners` gives a `company` runner per same-mind group. The page still edits the five places through `slotsView` until #454.
- `npm run up` (`scripts/up.mjs`) and `start-eldmoor.cmd` (Windows, double-click; it calls `node scripts\up.mjs`): one window
  for the whole game. It starts the relay with app runners on and `--resume-runners` and the Vite dev server as child
  processes (output prefixed and coloured `[relay]`, `[vite]`, `[up]`), then opens http://localhost:5173 once. Single keys
  (or the word plus Enter where raw mode is missing): `u` update (`git pull --ff-only`; refused on a dirty tree outside .claude/ (agent memory never blocks it; git refuses if the pull touches a file you edited, naming it; nothing is stashed) or a
  non-fast-forward; `npm install` only when package-lock.json changed, with Vite stopped meanwhile; then the relay restarts,
  and Vite too when vite.config.js, package.json or the lockfile changed), `r` restart the relay and its runners, `s`
  status (relay health, runners, Ollama models loaded), `h` help, `q`/Ctrl+C quit (runners get "stop" first so they
  release their heroes, then the relay, then Vite; the process trees are killed with `taskkill /T /F` as a last resort, so
  no node process or port stays held; closing the window does the same). A change under `scripts/` while it runs prints
  "relay code changed: press u (or r) to apply" (never an automatic restart mid-play). The relay keeps the running runners
  in `logs/runners/active.json` (kind, hero, name, mind, caps; a stop from the page, a crash or a finished runner leaves the
  list, a relay quit does not) and with `--resume-runners` (`RELAY_RESUME_RUNNERS=1`) starts them again once the page
  reconnects and names the same heroes (same id and name, alive; a hero that is gone, renamed by a new world or dead is
  skipped). The page's bridge reconnects by itself after a relay restart. Options: `--relay-port N`, `--vite-port N`,
  `--no-open`, `--repo DIR` (the checkout `u` pulls). The old way, `npm run relay -- --runners` and `npm run dev` in two
  terminals, still works. `npm run upcheck` tests it (real children on spare ports, a temp git checkout).
- `npm run runnercheck`: app runners (start/stop from the page, refusals, a mock Ollama runner end to end) and
  the relay's Anthropic concurrency queue (mock 429 provider).
- `npm run labelcheck` (#563): one steady runner label while a runner holds a seat. A held link reads "live" whether the agent calls tools, thinks or waits for a Claude slot (the relay still reports connected/waiting); a page that just (re)connected reads "connecting" until the relay's first links; a member the Fellowship runner lets go (`[Name] done (why)`, a released claim) leaves the runner's `heroes` for `left: [{id, name, why}]` and reads "no runner" at once, the gate saying why and restarting the Fellowship runner; a claimed seat whose runner has posted a turn line counts as ready (`implied`). The check plays a 120 s silent Claude turn on the real relay, supervisor and page modules with a fake clock.
- `npm run dm`, `npm run dmcheck`: the DM as an agent (see "DM agent").
- `npm run channelcheck`: the in-game channels rule (see "In-game channels").
- `npm run lorecheck`: learning the world (#188, see "Agent player").
- `npm run tiercheck`: tiered long-term memory (landmarks, chapters, `journal_search`, the overview, migration; see "Agent player").
- `npm run behavior-report`, `npm run behaviorcheck`: behavior logs for review (see "Behavior logs").
- `npm run focuscheck`: guild focus (#6, `src/sim/guildfocus.js`): each guild's leader picks Delve (crypt), Wyrmhunt (raid), Wayfaring (DM hooks) or Warpath (PvP) from the guild's state, no dice; it multiplies or reorders existing rolls only, so `GF.ON=false` (or no guild focused) rolls exactly as before; the Fellowship's guild never takes one; changes go to the chronicle and timeline (GUILD).
- `npm run archetypecheck`: Fellowship archetypes (#295, `src/data/archetypes.js`, `applyArchetype` in `src/sim/persona.js`): six archetypes picked on the setup page or the sheet, their stances toward each companion reaching prompts (#305), owner stances, no RNG.
- `npm run personacheck`: agent-built personality (#409): the `self`/`become` tools, daily limits, owner pins, the persona history, relay writing never overwriting the hero's own words, the turn-header line and the standing-order block, a reflection that changes the persona, privacy, save/restore and old saves, no RNG.
- Art tiers (#177, owner decision 2026-11-03: 32 px tiles now, a cheap path to 64): `src/render/tile.js` is the one place
  for the tile size: `TILE` (art pixels a tile, 32; tiers 32 and 64), `U` (world units a tile, 16 = world `T`: positions,
  camera, labels, effects and the procedural art) and `ART` = TILE/U. Terrain chunks are painted at TILE while any terrain
  asset is loaded (the procedural 16 px texel scaled up wherever no asset covers a pixel) and at U otherwise; `CH` keeps a
  chunk about 1024 art px square. Entities stand 32x48 at the 32 tier (`SPRITE_TILES`, `HEAD` for nameplates): generated
  sheets (`sprites.js` `ASSET_SPRITES`, `sheetFrame`: 3 frames by 4 directions, the hero tabard recoloured per faction from
  `palette.js` `SPRITE.key`) else the procedural sprite scaled by `PROC_SCALE` (`worldSprite`, a one-art-pixel outline).
  `palette.js` `TIER_SHADES` widens asset palettes per tier. Upgrading to 64: set `TILE=64`, run
  `npm run art:daily -- --tier 64` (same manifest, prompts and seeds), accept the set, re-base `FOLLOW_TILES`.
- Art (#177, `scripts/art/`): `manifest.json` lists every asset (kind, `sizes` per tier, priority, prompt, seed, palette paths into
  `src/render/palette.js`, the renderer hook naming its procedural fallback), the candidate models (pixel-art LoRAs
  on fal-ai through Hugging Face Inference Providers) and `allowance.monthlyUsd`. `npm run art:daily` (`daily.mjs`;
  `-- --now` to run at once, `--tier 32|64` (default `TILE`; the tier's LoRA scale, pixel grid and palette widening from
  the manifest's `tiers`: 0.55 / grid 4 at 32, 0.2 / grid 2 at 64), `--max N`, `ART_MAX_CALLS`, `ART_DAILY_BUDGET`/`--budget`, `--dry-run`) generates missing
  assets in priority order into `assets/incoming/<date>/` with a contact sheet, and stops at the day's share of the
  monthly credits (monthlyUsd / days in the month; HF gives free accounts no Inference Providers credits and PRO $2.00 a
  month, about $0.01 an image with pixel-xl), at the month's total, or when the provider refuses (402, a quota 429/403,
  rate headers at 0). It keeps every provider image as it came under `assets/incoming/<date>/raw/` before
  post-processing, and `npm run art:reprocess -- <date>|all [keys]` re-runs post-processing on them with no call. State in
  `assets/queue.json` (gitignored), one line a run in `logs/art.log` (the launcher's `s` shows it); refused models fall
  through to the next candidate and the one that answers is pinned. `npm run art:accept -- <ids>|all` (`--reject`,
  `--list`) moves reviewed images into `assets/` and the index, committed through a PR. Index and queue keys are
  `<id>@<tier>` (files `assets/<kind>/<tier>/<name>.png`, entries carry `tier`; keys from before tiers read as 32). `scripts\art\schedule.cmd [HH:MM]`
  registers the daily Windows task. `npm run art:gen` generates straight into `assets/`, `npm run art:sheet` writes
  the contact sheet. Post-processing (`post-texture.mjs` on the building blocks of `post.mjs`, zero-dependency PNG codec
  `png.mjs`): find the model's pixel grid and sample cell centres (the image at its own pixel scale, ~128 px from 1024),
  a seamless crop for tiles (one tile at the tier: 32x32 at 32) or a scaled subject for sprites, tone match and quantise to
  the palette (widened with shades, optional ordered dither), outline; an output under `post.minColors` (4 for tiles)
  is rejected as flat, not written. Browser: `src/render/assets.js` `asset(id)`/`assetPixels(id)` (null until loaded or
  when absent; only entries of the renderer's tier are used, so a missing tier draws the procedural art scaled to TILE),
  `onAssets`; `terrain.js` `ASSET_TILES`, `ASSET_ROAD`, `ASSET_EDGES` (dual-grid transition pieces, one tile each) and
  `ASSET_PROPS` draw from assets at TILE resolution. `npm run artcheck` (CI) checks it all against a mock Hugging Face
  server and fixtures (`scripts/art/fixtures.mjs`), incl. tier selection, the scaled fallback and `--tier 64`.
- `npm run gambitcheck` (#617, `src/sim/gambits.js`, vocabulary and class presets in `src/data/gambits.js`): an agent hero's gambits, an ordered rule list (`when` + optional `and` + `then`) that autopilot (first rule that holds and can run), the fight reflex (every fight rule that holds, in order; flee ends it) and the full-pack reflex run between turns. With no edit a hero runs its class preset, which is the old fixed policy written out rule for rule (hashcheck's `autopilot` row proves agent heroes on autopilot play identically); scripted heroes never use it. Tools (not orders, `act:false`): `gambits` (the list, ids, on/off, last fired, the vocabulary), `set_gambit {when, and?, then, id?, before?, on?, why?}` written in words ("ally hp below 40", "buy_potions 3"), `move_gambit`, `toggle_gambit`, `drop_gambit`, `reset_gambits {preset: class|cautious|empty}`; `GAMBIT.PER_DAY` 20 edits a game day. Weakening or dropping a safety rule (flee, potion, defend) is never refused: it is noted in the edit history and the persona history, the watch flags `no-flee-rule` and the digest/report count rule-driven acts per hero. The Agent tab shows the list (view only) with the rule that fired last; the purpose line names it.
- `npm run questcheck`: the quest log (see "Quest log" under Agent player): several quests per hero, focus, abandon, oaths, DM tags, save/restore and the scripted world unchanged.

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
  `AGENT_MODEL` to change; `--budget 1.00` is the default cap per runner, no turn cap (`--max-turns N` optional);
  cost line per turn). Without `--hero` the runner lists the agent-played heroes and takes
  the first living one with no runner, or says none is free.
- Pacing (issue #126, `scripts/pacing.mjs`, game side `src/sim/pace.js`): turns follow the game, not a
  stopwatch. Between turns a runner long-polls `POST /play/pace` (not a tool; it never consumes the hero's
  events or counts as link activity). A turn starts at once when something cannot wait (attacked, badly
  hurt, a choice, a table scene, a camp alarm: events marked `urgent=2` in `src/sim/notify.js`); once the
  minimum gap has passed (`--min-gap S`, default 20 real seconds) when the hero has unread news (an arrival,
  a vote, a party line, the narrator, an NPC); else after a heartbeat of game time (`--heartbeat MIN`,
  default 120 game minutes). A quiet hero takes about one turn a real minute at 1x and at most one per
  gap plus the turn at 8x; a paused world takes none; at most 2 immediate turns a real minute inside the gap.
  The runner stops when the hero dies or leaves agent play, and after `--max-fails N` (default 5) failed or
  empty turns in a row. Env: `AGENT_HEARTBEAT`, `AGENT_MIN_GAP`, `AGENT_MAX_FAILS`. More triggers (`src/sim/wakes.js`, `npm run wakecheck`): XP since the hero's last read is one bundled soft line ("+85 XP from 3 kills (...); 120 XP to level 4"), plus loot and quest progress and an elite kill (soft); a level up (names the ability, passive or level-10 path it opens), a rare or epic drop and a finished quest start the turn at once. Agent-played heroes only; no RNG. An older relay or page
  without `/play/pace` falls back to real time as if at 1x. No runner has a turn cap unless
  `--max-turns` is given (owner, #563: dollars are the limit): a local runner runs until stopped, Claude and OpenAI until stopped or their budget is spent.
- Start gate (#222, extends the run gate #171 in `src/ui/rungate.js`): a seat is **ready** only after its runner
  completed one warm-up model call with the model it plays (and the shared `num_ctx`, #221): before its first turn
  every runner (hero, company member, DM; `scripts/warmup.mjs`) posts `POST /play/ready {hero|role:'dm', runner,
  state:'warming'}`, makes one tiny structured call (Ollama `chat()` through the runner's queue, else the adapter's
  `call()`), then `{state:'ready', ms}` or `{state:'failed', error}`. Readiness belongs to the runner that reported
  it, so a restarted runner starts over; `/play/health` shows `heroes[].ready` (+ `warm`) and `dm.ready`, and the
  page gets it with the links. The page holds the world (after Continue, a new world, any runner start) until every
  living company seat and the open DM seat are ready; the banner reads "WAITING FOR MINDS · 3/5 READY" with each
  seat's state ("loading qwen2.5:14b (40 s)", "claimed", "warm-up failed: ...") and **Start anyway** (waives the
  seats as they are; a waived seat whose runner goes away must warm up again). Party frames and the DM frame show
  claimed / warming up / ready / warm-up failed. `play-headless --wait-ready` holds a headless world the same way
  (every living agent hero and the DM seat, which `--wait-ready` opens unless `--no-dm`, #559); without the flag headless runs as before.
  The DM seat always counts (#559, slice A of #520): the setup page requires a DM mind (no scripted DM; an older setup's
  scripted DM cleans to Claude Haiku), a setup world opens the seat from the first tick, the page opens the seat of any
  world it plays, and `--resume-runners` starts a DM runner for an open seat even when none was saved. While the gate or
  the DM's prep holds the world (`worldHeld()` in `src/sim/prep.js`), agent heroes get no paced turn and their acting
  tools (`act:true`: say, party_say, move_to, hunt, take_quest, propose, ...) are refused with "The DM is preparing the
  table; wait for the opening scene." (`offline:true`, so it never counts as a failed turn); reads still answer.
  The gate is continuous (owner decision on #559): the world runs only while every living agent-played company member
  and the DM seat have a live runner (thinking, between turns, waiting for a Claude slot all count; a warm-up that failed
  while its runner plays on counts too). A supervised runner that stops, crashes, hits its budget or lets a member go
  pauses the world at once and the banner names who; "Resume anyway" (Start anyway before the first run) overrides until
  the next change. Headless sims and checks without runners are never held. A failed warm-up never
  stops the runner. `npm run localcheck` (slow and crashing mock warm-ups) and `npm run uismoke` cover it.
- Autopilot: an agent-played hero with no command and no action that went through for `PK.IDLE` (120)
  game minutes, outside an adventure or a scene, carries on for its agent (`a.playIdle`, "autopilot: ..." in
  the Agent tab, with "Last agent order: N game min ago"): rest when hurt, hunt again when its last order was
  a hunt, follow the party, fight back, go home when hurt or full. In town (#466) it rests at the inn when hurt, sells
  loot, buys up to 2 potions, then walks to its last hunting ground (`a.playGround`) or a known region that fits its level
  and hunts; in the field with no hunt order it hunts a region that fits, moves on from one it outgrew, or heads home from
  one beyond it. A follower waits for a leader in town 4 more game hours, then hunts nearby alone; an open vote holds it. It
  never takes a job, bounty, Crypt or raid. The agent stays the mind; nothing is ever handed to the scripted rules, and any
  command takes over again. A level refusal at take_adventure names a ground to hunt instead.
- Danger edges (#465): a move_to or hunt {where} whose road enters a region whose lowest level is 5+ above the hero's
  stops at its edge the first time, with the danger in words (the land's feel, the hero's lore, the townsfolk's warning);
  the same call again within 12 game hours, or `force: "yes"`, walks on (never a hard block). Walking out of shouting
  range of a party leader who will not follow says so (`apart`). `npm run townpilotcheck` covers both.
- One mind per hero: an agent-played hero has no relay brain (Fellowship Minds: agents turns the members'
  brains off; the relay still writes their sheets) and voices no scripted line (no barks, banter, camp lines,
  quarrel replies or table lines; a silent agent's table reflex acts without a word). Its own lines (say,
  party_say, a table line) show "AGENT · <runner model>" in the Chat tab. Agents speak only English: the
  game refuses a say/party_say that is mostly non-Latin script.
- Hearing: a line from an agent-played hero (aloud in earshot, or a party shout in range) starts each listening
  agent's turn at once, at most once per `PK.HEAR_WAKE` (15) game minutes per listener; narrator, NPC and
  scripted party lines wake after the gap. When every member at a company camp is agent-played, the agents
  are told the fire is lit and talk if they like.
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
  env), so each hero can keep its own mind; `anthropic` (Agent SDK) and `ollama` (a local model,
  see "Model providers") and `openai` run today; the relay routes by hero id only. The next run for that hero resumes it. Runners
  never write another hero's file. A file whose hero name no longer matches (a new world
  reused the id) and the old session on `--new` are moved to `logs/agents/old/`, never
  overwritten. The single `logs/agent-session.json` of #75 migrates on first run.
- Other MCP clients: streamable HTTP at `http://127.0.0.1:8787/mcp` (or `:8789/mcp`
  headless), stateless, POST only, with the `X-Eldmoor-Hero` header or `?hero=<id>` (plus `X-Eldmoor-Runner` for a claimed hero); or stdio
  with `npm run -s mcp` (forwards to `PLAY_URL`, `PLAY_HERO=<id>` picks the hero). Plain JSON
  without MCP: `POST /play/call {tool, args, hero}`; `GET /play/health` lists the agent heroes
  and their links. A call that names no hero goes to the first living agent hero (the old
  single-hero path). Only localhost, no browser origins.
- From the app (no terminal per hero): run the relay with `--runners` (`npm run relay -- --runners`,
  `RELAY_RUNNERS=1`, or `start-eldmoor.cmd`). Then an agent-played hero's mind row, its Agent tab and its
  party frame have **Start runner / Stop runner** with the runner's state (starting, live, waiting,
  stopping, stopped, crashed with its last error line), provider/model, turns and cost; the Fellowship panel
  (Minds: agents) has **Start all five / Stop all** (one `scripts/fellowship.mjs`), and a company's Company tab
  **Start <company> / Stop <company>** (one company runner for two or more agent members with no runner yet, else a
  hero runner per member; #460). A picker chooses the mind
  it starts with (the hero's saved mind, Claude Haiku, Claude Sonnet, or a pulled local model; a runner started from the
  app plays Claude Haiku when nothing is saved, `APP_CLAUDE_MODEL` in `scripts/runners.mjs`, while terminal runners keep
  Sonnet; `AGENT_MODEL`/`DM_MODEL` override both) and its budget for a paid mind ($0.50-$10, beside the picker and in the Agents panel; no turn cap, #563).
  The state line shows spend of budget ("$0.081 of $2.00"), turns per minute and the last turn's age; its tooltip shows what the pacing waits for. The relay spawns the runners as
  child processes (`scripts/runners.mjs`: `GET /play/runner`, `POST /play/runner/start {kind:'hero'|'fellowship'|'company'|'dm',
  hero?, company?, provider?, model?, maxTurns?, budget?}`, `POST /play/runner/stop {kind, hero?, company?}`; kinds are a table; `dm` runs
  `scripts/dm-agent.mjs`, one at most, and is refused as "not installed yet" until that file exists), `node` with an argument array, never a shell; output in `logs/runners/<key>.log`;
  a stop writes "stop" on the child's stdin (it releases its heroes), then kills; a child also stops when
  the relay goes away. Limits: off without the flag, loopback and the game page's origin only, heroes the
  page names as agent-played, providers anthropic/ollama/openai, defaults $1.00 per hero, $2.00 for the Fellowship, $1.00 for the DM and no turn cap (budget caps $5, $10, $5; a
  turn cap only when asked; local runners have no budget, OpenAI runners keep the budget and take no Claude slot), at most `RELAY_MAX_RUNNERS` (default 6)
  runners, where the six seats (the five Fellowship members as hero runners or one Fellowship runner, plus
  the DM) always fit whatever the caps. Company runners (#460, epic #402): kind `company` (key `company:<id>`, the
  company named by `company` or one of its members as `hero`; $2.00 default, $10 cap) runs `scripts/fellowship.mjs
  --company <id>` and plays every living agent member of one company of any size, each with its own session, pacing
  and claim, picking up a joiner or a recruit who takes a fallen member's seat; it takes one hero seat per living
  member. `/play/health` names each hero's `company`, `companyName` and `size` (plus `lead`, `table`, `due` in a
  company of two or more; `seatInfo` in `src/sim/player-host.js` builds the list for the page and play-headless).
  Seats restart on their own (`adopt` in `scripts/runners.mjs`, every `ADOPT_MS`): a member who leaves a company is let
  go by the company runner and gets a hero runner with that runner's mind; a solo whose hero runner ended with its death
  gets one for its heir (`succeeds`) with the same mind, within `HEIR_WAIT_MS`; a stop from the page never restarts.
  The setup page starts one company runner for an apart group sharing one mind (`planRunners`). Claude slots: at most `RUNNER_CLAUDE_MAX` (default 3, at least 1)
  Claude turns at once across the runners; each supervised Claude turn leases a slot (`POST
  /play/runner/slot`, released after the turn, freed when the child exits) and waits for one when all are
  taken, so starting is never refused for slots (a company runner also queues its members with
  `--claude-concurrency`). Without `--runners` the buttons say how to turn it on.
- Relay concurrency: the owner's API org caps concurrent requests across all models. The relay keeps at most
  `RELAY_ANTHROPIC_CONCURRENCY` (default 2) Anthropic calls in flight (`scripts/providers/limiter.mjs`):
  decisions queue ahead of writing kinds and are dropped when their deadline passes in the queue (the sim
  plays them scripted); a 429 pauses the queue (retry-after, else backoff) and only writing kinds retry.
  `/health` shows `queues.anthropic` (depth, in flight, 429s, dropped). Keep `RELAY_ANTHROPIC_CONCURRENCY +
  RUNNER_CLAUDE_MAX` within the org's limit; with a very low limit, play runners with local models.
- Learn the world (#188, `src/sim/lore.js`): an agent hero knows only what it saw, heard or was told (`a.lore`, saved with
  the hero). `look` describes a creature it does not know ("a lean, quick wolf-like beast") with its own threat read in words
  (a d20 Lore/Perception read at first sight, from a hash, no RNG); never a level or HP number (events, the state header,
  `fight`, Table frames too). Fighting, killing, its tricks, a near death (below 30% HP: an event and a `lesson` reflection
  moment), a hero falling to it in sight, and any line heard that names it (say in earshot, a companion's shout, the
  narrator, a townsperson, `read_chronicle`; warning words mark it dangerous) teach its name, measure and tricks; the `lore`
  tool lists it all. Places: home region and friendly towns, then where it has been, landmarks seen, places heard of (quest,
  jobs, chat); `move_to`/`lead_to` refuse unknown places but always take a direction ("explore north") or "x,y". `hunt`
  takes `prey` (a creature known by name) or whatever is around except what it learned to fear; `list_jobs` gives the
  gate's rumour, not "fits"; townsfolk warn a green blade off the next region up. Background heroes keep the scripted
  level logic and never get lore; the hooks only touch `a.player` heroes, so `npm run sim` is unchanged.
- New world under the same ids (#219): New World reuses hero ids, so a runner that holds ids would play nobody. Hero and company runners poll `/play/health` (`watchWorld` in `scripts/pacing.mjs`) and, when a held id now names another hero (the name differs; the world instance id will be compared too once `/play/health` carries it as `world`), release their claims and exit with code 75 (`NEW_WORLD_EXIT`, `[world] a new world: ...` line). The supervisor (`scripts/runners.mjs`) restarts a runner that exits 75 with the same request after `RESTART_MS`, at most `MAX_RESTARTS` in a row without a turn; the restart sets the old sessions aside in `logs/agents/old/`. A DM runner whose seat is not open yet (a rare race at a new world; every world opens it from the first tick, #559) says so in its `[pace]` line and waits.
- Memories (#155, `src/sim/notebook.js`): every agent hero keeps its own searchable notes with `remember {title,
  text, tags[], about?}`, `recall {query?, tag?, about?, id?, n?}` (title and tag words 3, about 2, text 1, +1 pinned,
  plus recency; a tag or about filters), `update_memory`, `forget` and `pin`; 200 notes of 600 characters, the oldest
  unpinned is archived (40 kept, still found), 20 pins, 60 writes a game day. Saved with the world on the hero
  (`a.memories`); each turn's state header names the 3 most relevant (people in sight and the party, region, town,
  foe, adventure, an open scene or vote) by id and title only. Hardcore: they die with the hero; in a company a
  pinned note tagged `letter` is found by whoever takes the fallen member's place, nothing else. The DM has the same
  tools over its four note sections (search across them; `dm_status.relevant_notes`). Mirrored read-only as Markdown
  by the relay (from the page) or the headless world: `logs/agents/<world>/<heroId>-<name>/memory/` (`MEMORY.md`
  plus `<id>-<slug>.md` with front matter), the DM under `dm/memory/`; never read back. `--no-mirror` (or
  `RELAY_MIRROR=0`) turns the files off. A replaced world is purged: every world carries an instance id (`S.worldId`, new at `init()`, saved with the world, given to an older save on load; never read by `step()`), the page's hello and `play-headless` send it, and `logs/agents/<world>/.world` records the last one. A different id (a New World, an Import of another save, `--fresh`) deletes that world's hero folders and `dm/` (`purgeWorld` in `scripts/memory-mirror.mjs`) and logs `[mirror] new <world> world: purged N old memory folders`; the same id on reload purges nothing; links and anything outside `<root>/<world>` are never touched; session files are left to the runners. The Memory tab and the DM panel's **Notes** filter show them.
- Own personality (#409, `src/sim/persona.js`): every agent hero grows its persona. `self` reads it (voice, wants, fears, quirk, never_says, beliefs, traits, stances toward companions and people, backstory, recent changes, what it may still change today); `become {field, text, why, about?, op?}` revises one part in its own words (fields voice, wants, fears, quirk, never_says, beliefs, traits (op add/drop/set), stance (about: a companion, any hero or a person by name); aliases and over-long text are taken with a note; a why is required). `SELF.PER_DAY` 3 changes a game day, one per field (a stance per person); each lands in `a.persona.hist` (day, field, before -> after, why; 40 kept). Owner pins per field in the sheet editor (`a.persona.pins`, `pinField`) refuse a change with a message. The archetype, scripted sheet, relay writing and owner edits are the seed; the agent's words count as authored (`by[field]='self'`, `stanceBy[id]='self'`): relay persona writing and a sheet rebuild (`keepSelf`) never overwrite them. Every turn header carries one line (`brief.persona`, "Who you are: ..."); Claude runners write the full text (`paceBrief(id,{self:true})`, `/play/pace {brief, self}`) into their standing orders between `YOUR PERSONA` and `(end of your persona)` and refresh it when `brief.personaV` changes. Reflections ask "has this changed who you are?" (Claude: become with tool use; local/OpenAI: an optional `become` object in the forced answer). The Life view shows "Who they became". Private to the hero (channelcheck), dies with it, no RNG; old saves migrate on first touch. `npm run personacheck`.
- Stated aim (#535, `src/sim/intent.js`): `intent {goal, why, until?, done?}` saves `a.intent` (goal, why, until: game hours ->
  `untilAt` or a condition; set time, last progress, the `order` autopilot carries on, `done`). Every turn header says "Your aim: ...
  (set 3 h ago)" (`brief.aim`, `aimNote` in `scripts/pacing.mjs`); a done, stale (no kill, XP, level, adventure step or 4 tiles walked
  for `INTENT.STALE` 120 game min) or missing aim makes the turn ask first "What are you trying to do now?" (any mind: the intent
  tool; local/OpenAI reflections also carry an optional `intent` object in the forced answer); a scene open only names it. The order
  comes from the command the agent gives (or carries out) under the aim, else the goal's words (wait/rest, follow <name>, a known place,
  hunt words); autopilot then walks on to the place, hunts the ground (if it fits), follows or waits, after its safety checks. Done on
  arrival, the kills made, the hours up, the followed hero gone, or `done: "yes"`. A wait-like aim with no until ends in 2 h; with no aim
  `wait` is held to `INTENT.WAIT_NOAIM` (120). A company leader's new aim is shouted (a party line in range; `a.heardAim`), and those
  who heard it carry "Your leader's aim: ..." in their header. 12 aims a game day. Private otherwise (channelcheck). The purpose line
  (#534) reads it. Behavior: `no-aim` anomaly (`BW.NO_AIM_MIN`, outside camp and town rest) and "Aims stated (intent) per hero per game
  day" in the report. Agent heroes only, no RNG.
- Tiered memory (#153, `src/sim/tiers.js`, `a.tiers`): agent heroes and company members keep **landmarks** outside
  every rolling cap (a companion's death, joining or leaving a company, levels 5/10/15/20, Crypt clears, a boss or
  named elite slain, a nemesis taken or paid, and entries written with `journal_write {landmark: yes}`, 3 a day; 30
  kept, the lightest folds first), read from the record hook and `memory.js` lines only, and **chapters** instead of
  deletion: journal entries past 100 and notebook notes past the archive fold 20 at a time into a chapter (days,
  title, ~300 characters, 40 search words; scripted digest at once, rewritten by the relay kind `chapter` when it
  answers; 24 kept, the oldest two merge). `journal_search {query?, day?, n?}` searches entries, landmarks and
  chapters; `journal_read` with no arguments is the overview (landmarks, chapter titles, last 10 entries cut to 300
  characters; under ~2.5k tokens by its caps); the first turn of a resumed run is told to read it. Old saves migrate
  on first touch (an existing journal becomes chapter 1, unlabeled). Hardcore: they die with the hero. No RNG, so the
  seeded sim is unchanged. Mirrored as `LIFE.md`. `npm run tiercheck`.
- Semantic recall (#553, `scripts/embed.mjs`, `src/sim/semkey.js`): `recall` and `journal_search` (and the DM's `recall`) also find by meaning when the relay has a local embedding model (`OLLAMA_EMBED_MODEL`, default `nomic-embed-text`, `ollama pull nomic-embed-text`; `RELAY_EMBED=0` turns it off; `/api/embed` through `providers/ollama.mjs` `embed()`, no `num_ctx`). The sim never calls a network: for a query the relay asks the game for the texts (`_pool`), ranks them (cosine, scaled between `EMBED_MIN` .55 and `EMBED_FULL` .8, 300 ms budget, a cold cache fills in the background) and passes `{hash: 0..1}` as `_sem`; the tool adds up to `SEM.MAX` 2 to a hit's keyword score (a title or tag word is worth 3, so keywords still win) and marks it `semantic`, result `ranked: 'keywords and meaning'`. Agents cannot set `_sem`/`_pool` (stripped). Vectors are not in the save: `logs/agents/<world>/<heroId>-<name>/vectors.json` (the DM's under `dm/`), keyed by text hash, rebuilt when missing, stale or another model; a new world purges them with the folder, a fallen hero's file is removed. Not pulled, Ollama down or slow: scoring is exactly the game's own. The state header's relevant notes stay game-side. `play-headless --embed` opts in. `npm run embedcheck`.
- Reflection moments (#179, `src/sim/reflect.js`): at natural pauses (making camp, the end of a Table scene, a
  companion's death, an oath kept, a buy or sell of 150g+, a conversation of 4 lines within 3 game hours, and dusk from
  19:00 once a game day when something happened) the state header names `reflect {id, kind, why}` and the runner's next
  turn (a soft wake through `/play/pace {reflect:true}`; unless something cannot wait) is a short reflection: "Before you rest: what is worth remembering?". Local and
  OpenAI minds answer one forced structured object `{notes: [{title, text, tags, about}]}` (0-3, the #163 path) that the
  runner sends with `remember`; Claude gets the same prompt with tool use (4 tool turns). The runner closes it with
  `POST /play/pace {reflected: id, wrote}`; a note written while a moment is due closes it too and is stamped `rf`.
  Budget: `REFLECT.PER_DAY` 4 a game day per hero (dusk plus major events), 90 game minutes apart, a moment lapses after
  6 game hours, dusk is skipped when nothing happened; each counts as a turn for pacing, turn caps and cost. Only
  agent-played heroes get moments (the scripted sim is unchanged). Journal: every `journal_write` also becomes a memory
  tagged `journal` (title from its first sentence), so the journal is searchable with `recall`. Shown in the Agent tab
  (reflections today, the last one, new memories) and the Memory tab (NEW and REFLECTION badges); the behavior digest
  counts memories per member, the report has "Memories written per member per game day" and a `no-memories` anomaly
  after 2 game days without one (`BW.NO_NOTES_MIN`). `--no-reflect` or `AGENT_REFLECT=0` turns reflection turns off for a runner
  (the checks that count exact turns do; `--reflect` turns them back on).
- Quest log (`src/sim/questlog.js`, the dossier's Quest tab): a hero's quests in one list, each `{id, kind: board|dm|oath, title,
  giver, where, objective, progress, reward, status: active|held|done|failed|abandoned|expired, focus, started, ends, from}`;
  `questLog(a) -> {active, done (newest first, 20 for agent and company heroes, 8 for scripted), focus, offered}` (read-only, no dice,
  re-exported from `src/sim/index.js`). Kinds: board = the kill quest (`a.quest`) and town-board, townsperson and follow-up jobs; dm =
  jobs the DM agent posted (`h.by`, "DM agent") and the scripted DM's Fellowship-first jobs (`h.ff`, "scripted DM"), and a staged scene
  the hero sits in at the table; oath = the oath (`a.goal`) and blood debts (`a.nemesis`, at most 3 listed). Agent heroes hold up to
  `QL.MAX` 5 quests plus oaths: `quests`, `take_quest {id}` (a board job in town, or a job offered to the hero by name anywhere; the
  hook waits as phase `taken` for `K.MAX_DAYS` game days), `focus_quest {id}` (a job in focus is `a.adv` and the DM leads it; the
  running one is set aside, `adv.held`: foes gone, scene kept, still goes cold; focusing the kill quest or the oath sets it aside too; a
  held adventure is taken up again when its solo or leading hero, with nothing queued, comes within `QL.NEAR` 6 tiles of its next
  scene), `abandon_quest {id, reason?}` (a taken job goes back on the board; a running one ends as abandoned, for the party when the
  leader gives it up; oaths and debts refuse). `take_adventure` on a new job sets the running one aside instead of refusing. The pace
  brief carries `quest {focus, id, others}`, every turn prompt names it (`questNote` in `scripts/pacing.mjs`). The hero's view never
  says who made a job; scripted heroes keep one kill quest and one adventure (a seeded world is unchanged). Old saves need no migration:
  with no `a.qlog` the running adventure, else the kill quest, is the focus.
- Free actions (#522, `src/sim/ruling.js`): `attempt {what, how?, at?}` tries anything the tools never named, in one or two sentences
  (refused only for length (300), non-English, a dead or hidden hero, a fight round, or past `ATTEMPT.PER_HOUR` 3 a game hour; in a Table
  scene it is the act `scene_act {option: attempt, line: <what>}`, offered to agent members in every scene but a vote). The words are said
  aloud; the DM rules on it (`ruling_call` / `ruling_answer`: skill, a DC word easy 8 / fair 12 / hard 15 / heroic 18, at most 3 effects for a
  success and 3 for a failure, the lines heard, a note for the DM log only) and the game rolls d20 + the hero's skill (a 20 passes, a 1
  fails) and applies the effects in one resolver. Bounded set: `none`, `move` (up to 6 tiles; not in a scene), `reveal` place|fact|creature
  (lore, a memory), `attitude` (a person in earshot, -3..3), `open_talk`, `open_scene` (mystery, meeting, social, ambush, trap via
  `stage_scene`), `item` give|take (the give_item/take_item levers and their limits), `wound` (at most 15%, never below 10% HP),
  `condition` warded|exposed, `boon` d4/d6/d8 on the next attempt; level, XP, gold and life are refused (logged, `forbidden`). The game
  waits only while the DM's ruling voice polls (`TABLE.dmMs`, or its `budget_s` 4-30 s; a scene waits for it the same way), then the
  scripted ruling fills it (the DM's reflex: skill by keywords, DC fair, a reveal on a total of 15+); nobody listening rules at once.
  The hero hears the text, the roll and what changed (chat, an urgent event, the Agent tab's `ruling` line, the Table banner's beat and
  narrator line); every ruling is in the DM log (`detail.ruling`, by `dm-agent` or `scripted` with `fill`/`why`). State `S.rulings`
  (saved); `rulingTick` runs before the Table hold and is a no-op without it, so a seeded world is unchanged. `npm run attemptcheck`.
- `npm run playcheck`: a scripted mock agent plays through town, a job, a choice, a fight,
  the journal and a save/restore, proves a silent agent never stalls the world, and runs two
  mock agents on two heroes at once (routing, claims, links, the browser bridge, per-hero
  session files). The mock agent's waits drive game time, so it depends on the seed only.

## Companies (agents and Table mode)

A company is a group of heroes who travel and decide together (#402; the model is `src/sim/company.js`). The Fellowship (#68) is the default company: five places (Tank, Healer, three DPS) who are the story, held as `slots`. Every company member is always
agent-played (#148): founding, joining, replacement and a new world mark every member agent-played,
an older save's scripted or relay members are converted with a notice, and the only mind choice is the
model each member's runner plays with (Claude Haiku, Claude Sonnet, a local or an OpenAI model).
`npm run fellowship` plays all five Fellowship members, one Agent SDK session per member (`-- --company <id|name>` plays any other company).
- Decisions wait for the agent (`src/sim/runlink.js`): the host passes each member's link from the relay's
  claims. `connected`/`waiting` = a runner holds it (a slow agent is still there): a Table turn waits (nudged
  after `TABLE.turnMs`, reflex only after `TABLE.liveMs`, 2 min), a vote stays open past `PROP_MIN` for
  `COUNCIL.HOLD_MIN` (600 game min) more, an adventure choice for `CHOICE_HOLD`, each with a must-answer
  event so pacing starts the runner's turn at once; autopilot carries on outside scenes. No runner =
  gone: the page's runner-stop alert asks the owner (Restart, or Resume: that member's reflexes, the
  scripted rules, play it and decide until a runner holds it again); until then its decisions hold.
  `npm run sim`, the checks and play-headless have no owner to ask: a member with no runner plays by reflex.
  At 3x/8x a Fellowship decision asks the host to drop to 1x (`TABLE.drop`; page and play-headless honour it).

- Browser: `npm run relay` (the brain relay, port 8787; it also serves the agents' MCP tools),
  `npm run dev` (5173), found a company (its members are agents), then
  `npm run fellowship -- --budget 2.00`.
- Headless: `node scripts/play-headless.mjs --fellowship --port 8790 --warm 20 [--no-relay]`
  then `npm run fellowship -- --url http://127.0.0.1:8790 --max-turns 2 --budget 0.50`.
- `npm run fellowship -- --company <id|name>` (#460) plays one company instead (a name matches the company's name or
  one of its members); a company that is not the Fellowship gets company orders sized to it (`companyPrompt`: a solo its
  own short ones), log `logs/company-<id>.log`, and its run record in `logs/fellowship-runs.jsonl` carries `company`.
- The runner reuses the per-hero sessions (`logs/agents/<heroId>.json`, resumed next run,
  `--new` to start over), runner settings and claims of `npm run agent`; one overall
  `--budget` (for paid members), `--max-turns` per member (optional; by default every member plays until stopped or the budget is spent), each member paced like a hero runner (`--heartbeat MIN`, `--min-gap S`, the old `--cadence S` is the
  gap; a scene starts the member's turn at once), `--follower-model claude-haiku-5-5` for members other
  than the leader between scenes. Combined log `logs/fellowship.log`, per-run cost per member
  in `logs/fellowship-runs.jsonl`.
- Party tools (`src/data/player-tools.js`, `src/sim/council.js`): `party_say`/`party_read`
  (a shout in range, Chat tab and bubble), `propose`/`vote` (job, crypt, raid, split, other; the
  leader settles it: majority, leader breaks ties; members with no runner vote by reflex, a live
  agent's vote is waited for, see above), leader-only `lead_to`, `leave_party` (splits off for 6 game hours, costs bonds).
  A Crypt group or raid takes the whole company or none of it; an agent-played company
  is asked first (a `crypt`/`raid` proposal).
- Talking takes presence (#182, `src/sim/reach.js`): `party_say` is a shout heard within `REACH.SHOUT` 12 tiles
  (less in fog and storm; `say` stays at 7), and the result says who heard and who was too far away. Only members in
  range hear a proposal and vote (the absent hear of it when they rejoin, and the leader settles with those present);
  `lead_to` moves those in range; a Crypt or raid call needs everyone together (a reflex-only party, as in `npm run sim`,
  moves as one and is not held to it). `leave_party {where, when_hours}` and a `split` proposal's `meet_at`/`meet_in_hours`
  record a meeting plan (an open thread, plus a memory for those who heard it). `send_courier` (hired at a town gate,
  a few gold by distance, about 1.5 h plus 6 min a tile) is the one way to reach someone out of range. `earshot` (read-only, #395, `src/sim/earshot.js`) tells a hero before it
  speaks who would hear `say` (heroes and townsfolk within 7), which companions a shout reaches today (the range and why fog or
  storm shortens it), who is close enough to `talk` to (4) and which companions are out of range (names only, the courier hint),
  from the same hearer sets `say` and `party_say` use (`sayHearers` in `chat.js`, `shoutHearers` in `council.js`); every turn
  header carries it as one short "In earshot: ..." line (`brief.earshot`, absent when nobody is near). A member back after
  2+ hours apart: one present companion is told what was missed and asked to say it; the returner is told only to ask.
  The standing orders (`scripts/fellowship.mjs`, `scripts/agent-player.mjs`) say that distance cuts them off. The Chat tab
  shows a shout as "Kerin shouts: ..." with a dim "(Lorwyn, Fena)" of who heard, or "Kerin calls out, but no one is near";
  there is no "Party" channel tag any more.
- Table mode (`src/sim/table.js`, banner `src/ui/table.js`): Crypt entry and inner chamber,
  Kragmaw, elite/named foes, enemy ambushes, a member below 25% HP, DM checks and choice
  scenes on their adventures, and proposals open a scene. At 1x `step()` pauses the world
  (only the scene runs), the DM frames it, members act in initiative order (Reflex with gear)
  with `scene_act`; the table waits for a live agent (see above); a member with no runner acts by reflex
  once the owner resumed. At 3x/8x a scene with agents to decide drops the world to 1x; only a
  reflex-only scene resolves instantly with a summary. The View group's **Table: Auto/Off** switch
  (Off = Watch mode) never pauses. `npm run tablecheck` proves a scene waits for a silent but connected
  agent, reflex only without a runner, the owner hold, votes, `lead_to`, the all-or-none Crypt draft and
  determinism without a Fellowship.
- Session zero and arrivals (#437, #452, `src/sim/arrival.js`, `src/sim/prep.js`): one mechanism, two Table scenes played
  everyone at once (`PLAY` `opening`/`arrival`). Only in a world whose host reports runner links (the page, play-headless;
  `hasLinks`), so `npm run sim` and the seeded hashes are unchanged. **Session zero**: a setup world (`init({setup})`, or
  `play-headless --session-zero`) plans one opening per company (`S.opening.queue`, the followed company first). Once the start
  gate is ready the DM **prepares** while the world stays held: one bounded turn (`PREP.MS` 90 s, `PREP.CALLS` 20 tool calls,
  counted in `dmagent.js`; idle table polls and `prep_done` do not count; half of both on Continue or for a DM runner started
  again), ended by `prep_done`, a cap, Start anyway or the seat going away. The banner reads "THE DM PREPARES THE TABLE · 12 S ·
  3/20 CALLS" with Start anyway, the DM frame "preparing", `/play/health` `dm.prep`, `dm_status` `prep` (`host`, `opening_due`).
  No prep without a ready DM runner, or with no host holding the world (play-headless without
  `--wait-ready`); a DM runner waits for the prep only when `prep.host` says one will come. Then the opening scene opens
  ("SESSION ZERO · <company>"): the DM frames it through `table_call` (its call carries the campaign premise and opening beats,
  DM-only), else the scripted DM from the hall, the day, the oaths, the hall's first job and the gate captain's writ; members
  introduce themselves (a silent agent's reflex shows its persona line) and the leader may yield or be challenged; the
  introductions count as met (`talk.js`), the leader is told the first move. A solo's opening is the gate captain and a rumour.
  **Arrivals** (owner decision 5 on PR #406): a fallen member's seat is refilled through a scene at the company's next camp or
  town, never in the Crypt, a raid or a fight (`C.arrivals`; the world's background recruit of that class is reserved). The
  recruit (the fallen member's class, `SEED_BEHIND` under the lowest living member, agent-played, `a.succeeds` = the fallen id)
  is made and placed at the camp's edge or the town gate as the scene opens; the DM voices them (`table_call` voice, then the
  oath), the scripted DM when the runner is slow or gone (a reflex, #561); members greet, question, object (spoken, not a veto) or keep
  silent; the oath is sworn at the table (`campaign('recruit')`). Runners give the newcomer the fallen member's runner settings
  (`inheritRunner`, `/play/health` `heroes[].succeeds`). A solo's death leaves an heir at level 1 at home, a company of one,
  with a short opening (owner answer 2). Letters (`C.letters`, any company, keyed by writer): to whoever takes the writer's
  place, else the next joiner of their class, else the next joiner after `PARTY.LETTER_DAYS` 3. `tablecheck` (its `--arrival`
  child), `dmcheck` (prep caps, Continue, no host, the frame), `uismoke` (the banner).
- Dungeon crawl (#65, `src/sim/crawl.js`): when a company is in the group that goes down a dungeon whose spec lists
  `rooms` (`CRYPT.rooms`, from the landmark in `src/world/spec.js`; add chambers as data: `{id, name, frame, foes:[{type, n,
  name?, hits?, atk?}], lvl, hit, rounds, boss?}`, `type` a bestiary key incl. site foes), the run goes room by room instead of the one
  `pw` roll. Every round of every room is a Table scene of kind `crawl` (turns, `PLAY.crawl`), the DM-framed text naming the foes left and
  who is hurt. Options: `strike`, `guard` (draw the foes), the class special (`hold`, `ward`, `scout`, `read`), `heal`, `potion`, `retreat`.
  Dice at the table: a strike is d20 + (level + gear*.3)/2 + the round's edge against 10 + foe level/2 (a 20 lands twice, a 1 leaves you
  open); then each foe still standing strikes once (d20 against armour) for `room.hit` of a hero's max HP, the guard-holder drawing
  most blows; real HP, a hero at zero is dead (`fall`, hardcore); no hidden wipe roll. Most members falling back withdraws the party
  (a rearguard blow), a room not won in `rounds` (2 in every room, #264) drives it back; XP comes per room won (`CRAWL.ROOM_XP`: the clear payout divided by the rooms) and the last room adds `CRAWL.CLEAR_BONUS` (10%) with the gold and goods of `payClear` in
  `dungeon.js`; reflex scouts in round 1 only for rooms of `CRAWL.SCOUT_MIN` blows or more. The stair scene (`site`) still opens first and its choices tip every roll. Table Off (Watch) and groups without a
  Fellowship member keep the abstract roll, so the background balance and a seeded no-Fellowship hash do not move. Wired through
  `setCrawlHook` in `dungeon.js` (crawl.js is imported by `sim/index.js`); state is plain data on `CRYPT.group.crawl`, saved with the
  group; the record is `slotted().crawl` (`sim/company.js`) (runs, clears, driven, withdrawn, wipes, deaths, rooms). A world without `rooms` has no crawl.
- Everyone at once (owner request): `PLAY` in `src/sim/table.js` says per scene kind how it is played. `turns`
  (elite, ambush, boss, rescue, Crypt site/room, dungeon crawl): initiative order, one act changes the next. `all` (decision =
  every vote incl. break_camp, check, choice, staged meeting/social/trap/mystery): every member present gets the
  scene at the same moment (a must-answer event), `your_turn` is true for each until it answers (then `wait` is
  allowed), answers come in any order, and each live agent has its own `turnMs` nudge and `liveMs` wait side by
  side (not summed). Once nobody is waited on, the acts resolve in company slot order (never arrival order;
  reflexes chosen then), and a staged scene gets one combined outcome call for the DM instead of one per act.
  Only members within shouting range (#182) of the scene's anchor (a vote: its voters) take part. `tableView`
  adds `everyone_answers`, `answered` ("3/5") and `waiting_on`; the banner shows EVERYONE ANSWERS and
  "3/5 answered · waiting for Fena, Maelell". A kind not in the table plays in turns.
- Talk scenes (#407, `src/sim/talkscene.js`): a member's `talk` becomes a short Table scene of kind `talk` (PLAY 'all', the
  company present, options accept / decline / bargain / leave) only at a decision: a job offered, a bargain asked for, a matter
  for the company with companions in earshot, or a tense word (a hostile person, a threat). Greetings, small talk, buying,
  rumours and blessings never do. Once per conversation and reason, `ESC.PER_DAY` 6 a company a game day; the person then
  answers through the conversation (the DM agent's voice when listening, else scripted). Rules in one place: `ESC`/`escalation()`.
- Forced scene turns (#163): a local or OpenAI member whose own scene is open (the pace brief's `scene`: its
  legal option keys, incl. ready abilities by id) gets one structured answer (Ollama `format` / OpenAI strict
  json_schema: `{option: enum, line}`) and the runner sends `scene_act` itself; Claude keeps tool use, with one
  structured answer after a scene turn that missed. `wait` on your own scene turn is refused; calls written as
  text (`scene_act(deadeye, "...")`, `tool({...})`) run, and labels like "CallCheck" are cut from narration.
- Scene first (#515, `src/sim/scenewait.js`): every tool result (and a wait) of a member whose own scene waits carries
  `table_waits` ("A Table scene waits on you ...: answer with scene_act now (options ...)"); a local/OpenAI free turn stops
  there (or at once when the runner's watch of `/play/health` `heroes[].due` sees it; a model call waiting or in flight is
  withdrawn) and the forced answer follows in the same turn; forced answers go `urgent` to the front of the runner's Ollama
  queue; a Claude member whose scene is open at turn start answers it first with one structured call, and after any turn
  the runner checks the scene again. A runner whose member's answer waits behind other work (its turn in flight, a busy
  queue, the Claude slots) sends `POST /play/pace {queued:true}` once per scene; the table then waits up to `SW.EXTRA_MS`
  (90 s) more for that live member (`sc.q`). A live member the table still times out is `sc.miss` -> the `scene-missed`
  anomaly. `scene_act` returns `waited_s` (turn lines `sceneS`; the report's "Table scene answers": p50/p90 per mind,
  answers and misses per member). `npm run scenewaitcheck` (five slow mock members on one queue, a member mid-turn).
- Talk (`src/sim/talk.js`): an agent's `say`/`party_say` that repeats one of its last 5 lines, or a second
  introduction once members have met (both spoke in each other's hearing), is refused; every turn header
  carries the last 8 lines heard and the companions met.
- Round the fire (#571, `src/sim/fireside.js`): when a company with an agent at the table settles to rest at camp, a `fireside`
  Table scene (PLAY 'turns') opens on a topic from its day (campaign log, fallen, landmarks, oaths and lessons; else an oath or a
  question one member asks another), framed by the DM agent's table voice (table_call; `table_answer {rounds}` sets 3-6) or the
  scripted DM. `FIRE.STD` 3 rounds, `FIRE.BIG` 6 after a death, the Crypt, a boss, a newcomer, an oath kept, a merge or expulsion.
  Options: speak, `ask-<name>` (the asked one gets `answer`), `tell` (a story of one's past), listen; no dice, no votes. A silent
  round ends it; a live agent silent past `FIRE.LIVE_MS` (60 s) listens for the rest of the night. Afterwards each agent gets a
  reflection (kind `fireside`: what did you learn about them tonight?); a told story goes to the teller's `a.told` (persona
  history "told: ...", `brief.told` header line, `self` stories_told) and to each listener's notebook (about the teller, tags
  story, fireside). A `debrief` (PLAY 'all', one round) follows a rescue, a fall, a fight that left half below 35% or a vote
  decided by one. Only with a host that reports links (`hasLinks`) and agents deciding, so seeded worlds are unchanged;
  `FIRE.ON=false` turns it off (campcheck, dmcheck). Table lines (`TABLE.LINE_MAX` 600) are refused when longer, never cut, and a
  line that near-copies another member's line in the scene (names left out) is refused; the scene brief carries `you` (name,
  persona line, own oath, told stories) for forced answers. Townsfolk talk voiced by the DM agent runs to `CONV.DM_EXCHANGES` 10;
  each person remembers each hero (`p.hmem`: last words, follow-ups; `npc_call` member.last_time; a scripted "Back again").
  `npm run tablecheck` child `--fireside`.

## Model providers (Mixed minds, issue #97)

Each AI-played hero can ask a different model. Part 1 covers single decisions (town plan, crypt
call, fight or flee, say) and the Fellowship writing kinds (persona, backstory, memory); part 2
lets a local model play a hero end to end as an agent (`npm run agent`, `npm run fellowship`).

- Install Ollama (https://ollama.com), then pull a model: `ollama pull qwen2.5:14b` (fits a
  24 GB GPU with room to spare; Mistral Small, Gemma or a Qwen 32B also work). Ollama listens on
  `http://localhost:11434`; set `OLLAMA_URL` in `.env` if it runs elsewhere, `OLLAMA_MODEL` for
  the default model.
- Start the relay as usual (`npm run relay`). No API key is needed for local models; without one
  the relay still starts and only Claude requests fail (those heroes play scripted). On start it
  prints whether Ollama is reachable and which models are pulled; `GET /health` lists the same
  under `providers`.
- Pick a mind per background hero (Developer toggle; company members are always agents, #148): Scripted / AI / Agent, and
  for AI a provider (Claude, Local (Ollama), OpenAI, Google) and a model picked from what the relay
  reports. The setting is `a.brainCfg = {provider, model}` on the hero (same shape as the agent
  runner's `runner` settings), saved with the world; the brain sends it with every request for
  that hero, Fellowship sheets included.
- What to expect: zero cost. Measured on the owner's RTX 4090 with `qwen3.5:4b`: 0.3-0.7 s per
  town plan and about 0.25 s per line once loaded (the first call, which loads the model, took
  about 5 s; the relay keeps it loaded for 30 min); a 14B model will be a few times slower. Local calls get longer timeouts: 8 s per decision, 30 s or more for writing
  (`RELAY_LOCAL_TIMEOUT`, `RELAY_LOCAL_WRITE_TIMEOUT`); the sim waits up to 9 s. Smaller models
  pick legal options (the schema forces that) but reason less well and drift out of voice more.
  Thinking models (qwen3.x) are asked with thinking off, or they spend the budget thinking.
- Every answer is validated the same way as Claude's; a bad, slow or missing answer falls back to
  the scripted rules. The Mind tab, Chat tab and Minds panel tag which model answered
  (for example `qwen2.5:14b · local`), and the relay log and `--verbose` log record provider and model.
- Adapters live in `scripts/providers/` (one interface: `call({system, user, schema, maxTokens,
  model, effort})`; Ollama and OpenAI also have `chat({messages, tools|format})` for the agent loop).
  Google is a stub that reports "not configured" until built.

Local agent runner (part 2):

- One hero: press **Agent** on it (or `play-headless`), then
  `npm run agent -- --hero <name|id> --provider ollama --model qwen2.5:14b`. No key; the settings
  are saved in the hero's session file (`runner: {provider: 'ollama', model}`), so later runs need
  only `--hero`. `--provider anthropic` switches it back to Claude (the Claude session is kept).
- A company: give each member its runner once with `npm run agent -- --hero X --provider ollama
  --model M --max-turns 1`, or play all five locally with `npm run fellowship -- --provider ollama
  --model qwen2.5:14b`. Mixed companies work: members saved as `ollama` play locally, the others
  through the Agent SDK (they still need `ANTHROPIC_API_KEY`; without one only local members play).
- How it plays: `scripts/local-agent.mjs`, a small tool-calling loop on Ollama's `/api/chat`
  `tools`, through the same game tools as Claude (`/play/call`), with the same system prompt,
  turn prompts, claims, pacing, scene turns and `--max-turns`. Every turn prompt carries a fresh state header
  from the game (`POST /play/pace {brief:true}`: state, doing, HP, place, foe, unread news), a first answer
  without a tool call is re-prompted once ("Act through a tool"), only the latest narration stays in the
  history, and a turn with no tool call, every call rejected, or a narration repeating the last one with no
  world-changing call is an empty turn (it counts toward `--max-fails`). Prompts ask for English; a reply that
  is mostly non-Latin script is re-prompted once in English and otherwise counts as empty (never shown or kept).
  Sampling: temperature 0.6, repeat_penalty 1.15; after two empty turns in a row the next starts from a fresh
  context. `chat()` uses node:http with its own timeout (`OLLAMA_CHAT_TIMEOUT`, 600 s, a clear "busy or
  loading" message instead of undici's 5-minute "fetch failed") and one queue per runner process
  (`OLLAMA_PARALLEL`, default 1: a company runner's local members take turns). Before every local turn the
  runner checks `/api/ps` and warns when Ollama holds another model (the relay's minds evict it on one GPU);
  with no `--model` given it plays with the model Ollama already holds. The runner state line warns when the
  minds and a runner use different local models. Every call is checked against the
  tool table first (bad names or arguments go back to the model as an error, never to the game).
  A turn ends when the model answers in words, at `--tool-turns`, or right after a `wait` returns
  (one last call without tools asks for the narration; small models rarely stop on their own).
  Models without tool support switch to JSON actions (the tool list in the prompt, replies forced
  into `{tool, args, narration}`), remembered per hero; calls written as text
  (`<tool_call>{...}</tool_call>`) are understood.
- Memory: the conversation is kept in the session file (`local.history`, tool results cut to 400
  characters, oldest whole turns dropped past 24k characters; the journal is the long-term memory).
  Context (#221): Ollama reloads the whole model whenever a request asks a different `num_ctx` (and one
  without it gets the server default, 32768 on the owner's PC), so the adapter (`scripts/providers/ollama.mjs`)
  sends one `num_ctx` on every request: the agent loop, forced scene/reflection answers (`chatAsk`), the
  relay's decisions and writing, the DM loop and its table and talk voices. It is `OLLAMA_NUM_CTX` (default
  16384), read in one place (`numCtxFrom`); `--num-ctx` sets it for one runner, so keep it equal to the
  relay's. The relay log, `/health` (`providers.ollama.numCtx`), the runner start line and the runner state
  line (`ctx 16384`) show it; a runner warns when `/api/ps` shows its model loaded at another context
  ("Ollama holds qwen2.5:14b at 32768; runners ask 16384, so it reloads each time"). A generation Ollama
  aborts for repeating tokens ("token repeat limit reached") is retried once from a trimmed history at
  temperature 0.4; a second abort ends the turn empty (flag `looped`) without counting toward `--max-fails`.
- Turn line: tool calls, seconds (and seconds in the model), model calls, tokens in/out, `$0 (local)`.
  The claim carries `{provider, model}`, so the mind row's Agent mode, the Agent tab and the Minds
  panel tag the runner (`qwen3.5:4b · local · live`); `/play/health` lists it as `heroes[].runner`.
- Measured live (RTX 4090, `qwen3.5:4b`, thinking off): 0.5-1.5 s per model call alone, about
  6-9 k input tokens per call (tools and history), 6-12 calls and 5-25 s per turn; five Fellowship
  members at once: 1.5-3 s per call (Ollama queues them), 20-40 s per turn. A 4B model plays legal
  moves but loops (re-reads, forgets to wait); expect better from 14B and up.
- `npm run localcheck` (in CI) tests all of it against a mock Ollama: the loop, the JSON fallback,
  the runner end to end on a headless world (claims, tags, session file, resume) and a local
  Fellowship.

### OpenAI (ChatGPT models)

The OpenAI provider (`scripts/providers/openai.mjs`) uses the Chat Completions API with strict
JSON-schema structured output for decisions and writing, and the same tool-calling agent loop as
Ollama (`scripts/local-agent.mjs`) for agent play. It is billed per token by OpenAI.

Owner setup:

1. Create an API key at https://platform.openai.com/api-keys and add credit under Billing. API
   billing is separate from a ChatGPT Plus subscription: Plus does not pay for API calls.
2. Add `OPENAI_API_KEY=sk-...` to `.env` (ignored by version control; only the relay and the agent
   runners read it, never the browser). Optionally `OPENAI_MODEL=<id>` (a default; there is none in
   code) and `OPENAI_BASE_URL` (default `https://api.openai.com/v1`, or any OpenAI-compatible server).
3. Restart the relay (`npm run relay`). `GET /health` now lists OpenAI under `providers` with the chat
   models your key can use; the Fellowship panel's mind row (AI) and the Start runner picker fill from it.
4. Pick **OpenAI** in a member's mind row and choose a model (the row says "pick a model" until you do),
   or play an agent with `npm run agent -- --hero <name|id> --provider openai --model <id>` (saved in the
   hero's session file; later runs need only `--hero`), or `npm run fellowship -- --provider openai --model <id>`.
   Tags read like `gpt-6-luna · openai`.

Notes: the model ids and prices were read from OpenAI's pages on 2026-11-01; pick any model from your
own list. The cheapest current chat model on the pricing page was `gpt-6-luna` ($0.10 in / $0.50 out per
1M tokens, https://developers.openai.com/api/docs/pricing). The price table in `openai.mjs` (`PRICES`,
with its source and date) drives cost; a model not in it reports tokens with cost "unknown" (the turn
line says so; the run budget cannot count it). Cached-input discounts are ignored, so costs are an
upper bound. Every request sends `reasoning_effort: "none"` (Chat Completions supports function calling
on the current reasoning models only with it); a model that rejects the field is asked again without it.
Errors: 401 "bad or missing key", 429 "rate limit" (the relay's limiter queues OpenAI calls,
`RELAY_OPENAI_CONCURRENCY`, default 4, pauses on `retry-after`, drops a late decision and retries writing
kinds; an agent turn waits `retry-after` itself), "out of credit" for `insufficient_quota`, "reply cut
off", "model refused". A failed call means the hero plays scripted. Agent runs report real cost per turn
(`| turn $ | run $ | session $`), stop at `--budget`, and appear in the Start runner picker as
`<model> · openai`. The runner reads the key from its own environment/`.env` like the Claude runner
does, and never prints it. `npm run openaicheck` (in CI) tests all of it against a mock OpenAI server,
with no key and no network.

### Hugging Face router (issue #552)

A fourth mind provider, id `huggingface` (label "Hugging Face", tag `<model> · huggingface`): the Inference Providers router at
`https://router.huggingface.co/v1` speaks OpenAI Chat Completions, so it is `scripts/providers/openai.mjs` with other options
(`hfAdapter`, `HF_OPTS`). Setup: `HF_TOKEN=hf_...` in `.env` (the same token the art pipeline uses; read by the relay and the runners only, never
printed, scrubbed from errors); optional `HF_MODEL` (default model), `HF_MODELS` (comma list that replaces the picker list), `HF_BASE_URL`.
Recharge is off, so the owner's credit is the free monthly allowance, shared with the art pipeline (the picker rows say so): a request carries
only `model`, `max_tokens`, `messages` and the structured-output/tools fields, never provider or billing options. Cost is the reply's
`usage.estimated_cost` (turn line, run budget, relay stats); a reply without it is "unknown", as for an unpriced OpenAI model.
- Models: not every Hub model has an enabled provider (400 `model_not_supported`), so the list is curated, `HF_MODELS` in the adapter
  (Llama 3.1 8B, Llama 3.3 70B, Qwen 2.5 72B, DeepSeek V3; each had a live provider on the Hub on 2026-11-03). The relay checks each once at start
  with one tiny call (`max_tokens` 1; a few millionths of a dollar), caches the answer for its life and drops the unsupported ones
  (`GET /health` `providers.huggingface.models`, plus `dropped`); runners do not repeat the check, a model that answers `model_not_supported`
  fails with an error that names the picker list.
- Structured output: strict `json_schema` first; a provider that rejects it (400 naming the schema) is asked again with `json_object` and the schema in
  the system prompt, remembered per model; the relay validates either way. No `reasoning_effort`. Tools use the OpenAI tools path; a model that
  says it has no tool support sets `noTools` and the local loop switches to its JSON-actions mode.
- Errors: 401 "bad or missing HF_TOKEN"; 402, or a 429 naming credits, "Hugging Face allowance used up (recharge is off); the hero plays scripted / the
  runner waits" (kind `quota`, never retried); other 429s pause the limiter (`RELAY_HF_CONCURRENCY`, default 4, `queues.huggingface`).
- Agent play is the OpenAI path (`--provider huggingface --model <id>`, `openaiRunner` in `scripts/agent-chat.mjs`, same loop, forced scene answers
  and reflections); no Claude slot, keeps the kind's turn cap and budget caps. `npm run hfcheck` (in CI) runs it all against a mock router.

## DM agent (issue #66, part 1)

The DM seat is always held by an agent (the Hard rule; slice D #562: older saves convert on load, `convertOldDm` in `src/sim/save.js`, with a DM log notice, a scripted-DM setup becomes Claude Haiku, no RNG). The agent sits in the seat between scenes: it reads the world, keeps campaign notes and shapes
what comes next through the world levers; the scripted DM keeps running beside it as the world engine and the DM's reflexes, unchanged. It never
controls a hero and never kills anyone by fiat (no lever touches HP, level or life, and a pull that piles
danger onto a badly hurt Fellowship member out in the field is refused). It can also stage narrated
encounters and speak at their tables (issue #132, below).

- **Fellowship first (issue #165).** The DM's priorities are the Fellowship, then the overall world (a Hard rule).
  - Agent: the standing orders and every turn prompt start with them (`fellowNow`); `dm_status` lists `fellowship_first` and `fellowship_needs` (summary, items: where they ride, open threads and oaths, pending Table scene or vote, hurt members, what is under way, what would make their next hours interesting; `quiet` when nothing is pending) before the world, plus `fellowship_change`, a signature of their situation. The DM never reads hero notes. World-shaping that does not touch them comes after, and only when nothing is pending for them.
  - Cadence: besides each game evening, the runner takes an extra turn when `fellowship_change` differs from the last turn's (they arrived or set out, a scene ended, a member fell, an oath or job finished), at most `EVENT_MAX` 3 a game day, `EVENT_GAP` 120 game minutes apart, still behind the Table/vote wait and the real-time minimum gap (`eventDue` in `scripts/dm-agent.mjs`; the DM seat has no `/play/pace`, that route is the heroes'). `src/sim/dmfocus.js` is the one place that knows where the Fellowship is.
  - Scripted DM (`src/sim/dm.js`, deterministic): the Fellowship's hall board always keeps one posted job that concerns them (a member's oath, the living elite nearest their road, or a townsfolk job in the region they ride, level band permitting) and fills first; outlying boards keep a floor of `K.FLOOR` 1 posted job and fill up to `K.HOOKS` only while the Fellowship has a job under way.
  - Reserved share: with a Fellowship, `FOCUS.RESERVE` (about a third, at least one) of each lever's `perDay` limit and `STAGE.RESERVE` (1) of the 3 staged scenes a day are kept for pulls near the Fellowship (their regions, hall, members); world pulls hit "kept for the Fellowship" first.
  - Measure: `S.dmFocus` counts DM actions (board posts, applied levers outside adventures, staged scenes) and those that touched the Fellowship; `dm_status` shows the share, the behavior digest has `dmFocus {acts, fellow, share}`, the report prints it, and `npm run dmcheck` asserts most scripted-DM actions concern the Fellowship (about 60% over 150 game hours) and that the run is deterministic.

- Campaign seed: `docs/campaigns/<world>.md` (H2 Premise, Threads, Characters, Plans, Secrets; bullets `- **Title**: text`) is parsed by `src/sim/campaign.js` and seeds the DM's notes once (`from:'campaign'`, premise pinned in plans) when a world's DM state is created, or on load for an older save with empty notes. The host hands the text over (`provideCampaigns`: Vite `?raw` glob in `src/main.js`, `scripts/campaign-files.mjs` in Node); no file, no seed. `dm_status` shows `campaign`. Heroes never see it (`npm run channelcheck`); `npm run campaigncheck`.

- In the game: `npm run relay -- --runners` (or `start-eldmoor.cmd`) and `npm run dev`; the seat is
  open from the first tick (the setup page picks the DM's mind); open the **Dungeon Master** panel and press
  **Start DM** (Claude or a pulled local model). The seat (link, runner mind, runner state and last error) shows there and as the
  DM row of **Minds at play** (Start DM / Stop DM there too). Without `--runners` the button says how to
  turn runners on; from a terminal instead: `npm run dm` (one runner; it claims the seat).
- Headless: `node scripts/play-headless.mjs --dm --agents 0 --port 8789` (no agent hero, the seat open),
  then `npm run dm -- --url http://127.0.0.1:8789`.
- Runner (`scripts/dm-agent.mjs`): Agent SDK with `claude-sonnet-5-5` by default (`DM_MODEL`, `--model`,
  `--effort`), or `--provider ollama --model M` through `scripts/local-agent.mjs`; `--budget 1.00` by default
  and no turn cap (`--max-turns N` optional; a local DM runs until stopped); `--cadence evening` (a turn now, then one every game
  evening at 18:00) or `--cadence S` real seconds, never less than `--min-gap S` (20) apart; stops after
  `--max-fails` failed or empty turns in a row; never starts a turn while a Table scene or a party vote is open. One model
  call at a time; a rate limit (429/overloaded) backs off 30 s up to 10 min and retries. Cost line per
  turn. Session `logs/agents/dm.json` (keyed by the world's tag, resumed next run, `--new` sets it aside).
- Tools (`src/data/dm-tools.js`, game side `src/sim/dmagent.js`), over MCP at `/mcp?role=dm` (or the
  `X-Eldmoor-Role: dm` header), plain JSON at `POST /play/dm {tool, args}`: `dm_status`,
  `read_timeline`, `read_chronicle`, `read_dm_log`, `fellowship_view`, `heroes_near`, `npcs`,
  `regions`, `hooks`, `levers`, and the reads of what a DM at a table would have (#558, `src/sim/dmsight.js`, read-only, no RNG): `hear {company?, hero?, since?, n?}` (the words said aloud since its last hear: say in earshot, party shouts and table lines of agent heroes with speaker, company, time and place, 200 lines at most, kept in a ring `S.dmAgent.ear`; never narration, whispers, scripted barks, journals or memories; `dm_status.unheard` counts them), `survey {near, radius?}` (region, roads, water, impassable edges, towns, landmarks and marked places by direction and distance, and up to 6 legal `x,y` spots that `mark_place`, `place_person` and `stage_scene` accept; a refusal of those about the ground names `survey`) and `world_standing` (guild focus and why, rivalries, the wyrm and its last fall, the Crypt record, auction extremes and shocks, conditions, events, top five heroes); member views (`fellowship_view`, `companies_view`, `heroes_near` for company members) also carry `carries` (gold, gear score, quest items by name, potion and scroll counts, never the pack), `quests` (kind, title, status, focus) and `knows` (creatures feared or beaten, places, people met, capped); `fellowship_needs` items say what they spoke and what a member carries. `notes_read`, `notes_write` (threads, characters, plans, secrets; saved
  with the world in `S.dmAgent`), `pull_lever` (`pull(name, params, {by:'dm-agent', reason})`; at most
  `DMA.PULLS_PER_DAY` 8 a game day on top of each lever's limits; `named_foe` stays the scripted DM's), the flat lever tools `post_hook {town, tpl, giver?, reward?, region?, place?, for?}`, `place_person {role, near, name?, faction?, want?, attitude?, hours?, spot?}` (create_npc) , `mark_place {kind, near, name?, hours?}`, and `give_item {hero, item, by?, ilvl?}` / `take_item {hero, item, by?}` (#524: a quest item, token or consumable, or one plain gear piece a day at or below the hero's level, never an epic; `by` a person within 7 tiles hands it over, else it is found; take is quest items only; refused in a fight; urgent-1 event; `give_token`/`take_token` are now aliases) (#413: each with a reason, `near` read like `stage_scene`'s, pulled through pull_lever's path, so the same caps, limits, Fellowship reserve and DM log),
  `ruling_call`/`ruling_answer` (rule on a hero's free action, #522; see Free actions under Agent player),
  `log_intent`, and its in-game voice `narrate` (`{text, near, radius?}`: heroes near a hero, town,
  region or "x,y", or everyone at the open Table scene, hear it in their Chat tab and the Table banner;
  12 a game day) and `npc_say` (`{npc, text}`: a townsperson or placed person speaks to whoever is within
  earshot; 16 a game day). `whisper {hero, text, as?}` (#523) gives one hero a line nobody else hears (in an open Table scene or within 4 tiles of the placed person `as`; it lands in that hero's chat as "(whispered) ...", the table sees only "<npc> leans close to <hero>"; 8 a day) and `dream {hero, text}` a dream delivered when an agent hero next wakes from a camp or an inn rest ("You dream: ...", a soft wake and a reflection moment; 2 a day); the DM log names the hero, not the text. The seat is claimed like a hero (`POST /play/claim {role:'dm', runner}`); `/play/health`
  reports `dm: {seat, link, claimed, runner}`. The game answers only while its seat is open.
- Word and names (#637, #638; levers registered from `src/sim/rumours.js` and `src/sim/epithet.js`, so pull_lever's caps, the companies' reserve and the DM log apply): `seed_rumour {town|region, text, about?, days?, who?}` gives a town's innkeeper, gate captain and bard (or the towns bordering a region; `who` one of them) 160 characters to pass on for 1-5 game days in their own words, to a hero who talks to them (woven into the DM voice's answer when it carries `word_to_pass_on`) or reads list_jobs (`word_at_the_gate`), once a game day a hero; `about` goes on the hero's lore as heard of from the teller (`heardOf` in lore.js); 6 live, 3 a town, 4 a day, lapsing with its days, a dead foe, a faded place or a gone person; `hooks` lists them as `rumours`; the DM log counts tellings without the words. `bestow {hero, title, why, by?}` names a hero after a deed (2-24 characters, no numbers or level words; `a.epithet`, `styled(a)` "Fena Wightbane" in look, inspect, status, self, the hero card, party frame, chronicle, timeline kind `title`, Table banner and the DM's member views), proclaimed by a person within 7 tiles or the narrator, a landmark and a reflection moment; 2 a day, not the same hero within 3 game days; a hero who refuses it aloud (say, party_say, attempt) drops it and gets no further name. `npm run rumourcheck`.
- DM log: the agent's entries carry a **DM AGENT** tag and its reason; the **DM agent** filter shows them.
- Measured live (Sonnet 5.5, effort medium, headless day 4): first turn 15 tool calls, 18 s, $0.056 (notes
  in all four sections, a ruin and a wary hermit, one refused pull it corrected); a quiet turn 3 calls, 8 s, $0.013.
- `npm run dmcheck` (in CI): tools, notes, limits and refusals, save/restore, a silent seat leaves a
  seeded world identical, relay routes and MCP, the browser bridge, and the runner end to end on a mock Ollama.

### Staged scenes and the DM at the table (issue #132)

- `stage_scene {kind, near, frame, title?, cast?, reason}` (`src/sim/staged.js`): `elite` (a named foe built
  from the bestiary at a level bounded by the party's: at most `STAGE.LVL_UP` 2 above its average, asking for
  more than 3 above is refused), `ambush` (a pack of the region's creatures from the encounter builder),
  `meeting` and `social` (a person with a want, placed through `create_npc`), `trap` (hidden; a d20 save, never
  below 10% HP) and `mystery` (a `mark_place` marker; a Lore/Perception roll uncovers `cast.reveal`). `near`:
  "fellowship", a member, "x,y", a place or a region. The cast walks to the member (or waits at the place;
  a trap or a strange place lies just ahead of them) and a Table scene opens when they meet; the frame
  reaches the members as narration. `cast.choices` relabels the legal Table actions only. Refused: more than
  3 a game day, one still pending, an open scene or vote, a fight or trap while a member out in the field is
  below 35% HP, a foe far above the party, a creature not of that region, a town. All of it in the DM log
  with the DM AGENT tag; the banner shows the staged cast.
- At the table: the DM is asked short calls (`table_call` / `table_answer`): voice the person or foe, describe
  each member's act (true to the dice), and pick one complication from a legal set (`none`, `omen`, and per
  kind `falter`/`reinforce`, `rival`, `tremor`). Each call has `TABLE.dmMs` (6 s) at 1x, and only while the
  runner is polling; then the scripted DM fills it, and after 2 misses it fills the rest at once. At 3x/8x
  every slot is scripted and the scene resolves in one step.
- Ruling voice (#522): `npm run dm` also rules on the heroes' free actions (polls `ruling_call`, one forced structured answer with
  enums for skill, DC and effect kinds, then `ruling_answer`; `--ruling-model`/`DM_RULING_MODEL`, default the table model; `--ruling-budget S`,
  8 s with Anthropic, 25 s local; `--no-ruling-voice` leaves every ruling to the scripted DM). A `[ruling]` line per call.
- Runner: `npm run dm` answers the calls with a table voice (one structured call each: `claude-haiku-5-5` by
  default, `--table-model`/`DM_TABLE_MODEL`; with Ollama the seat's own model; `--no-table-voice` leaves them to
  the scripted DM). Its cost counts toward `--budget`; a `[table]` line per call.
- `npm run tablecheck` stages every kind with a mock DM (and a silent one, no runner, 3x, a save mid-scene,
  expiry); `npm run dmcheck` covers the refusals and the table voice over `/play/dm`.

## In-game channels (issue #123)

The owner's rule: the DM and the players talk only inside the game. How it holds:

- Heroes hear, they do not read minds. Everything said reaches a hero as a line in its chat buffer
  (`a.chat`): `say` within earshot, party shouts within 12 tiles (#182; couriers carry word farther), townsfolk, and the DM's `narrate` / `npc_say`.
  Agents read it with `chat_read` (and `party_read`), and as events ("The narrator: ..."); a brain
  hero's snapshot carries its last heard lines. The Table banner and `tableView` show a narrate line
  sent to the table. Hero tools never answer with DM notes, the DM log, lever reasons, or another
  hero's journal, memories, persona, mind, narration or session; `look` no longer says who is
  agent-played; persona/backstory snapshots list companions by name, class and origin only.
- Relay (`scripts/relay-mcp.mjs`): a claimed hero answers only the runner that claimed it (runners
  send `X-Eldmoor-Runner` / `?runner=` on `/mcp` and `runner` on `/play/*`; anyone else gets 409); a
  held DM seat answers only its runner; `/play/dm` and `/mcp?role=dm` refuse a call that names a hero
  or comes from a runner holding one; `/play/call` and `/play/narrate` refuse the DM role; one runner
  never holds a hero and the DM seat. `/play/narrate` only feeds the watcher's Agent tab. `GET
  /play/runner` gives the runners' output lines only to the page's origin.
- Runners: each member and the DM keep their own session; turn prompts are fixed text and standing
  orders come from the seat's own status; the company runner shares only game state (`/play/health`:
  ids, names, roles, links). The system prompts say that others are reached only in the game.
- `npm run channelcheck` (in CI) plants unique secrets in DM notes, the DM log, lever reasons, another
  member's journal, memories, persona, mind, narration and session prompt, gathers every hero tool
  result, event, runner prompt and brain snapshot, and fails on any secret; it also proves a narrate
  line reaches members in range (and the table) and not one far away, npc_say reaches earshot, party
  chat reaches every member, and the relay keeps the seats apart.

## Behavior logs (for review)

Issue #129: structured, append-only JSONL for the watcher and the `playtest-reviewer` agent, never read
by any agent, tool or the game. Under `logs/behavior/<world>/` (gitignored; each file rotates at 5 MB,
three old files kept): `<world>` is the world id the page names (`eldmoor`, `stepping`) for the relay,
and `<world id>-headless` for `play-headless` (`--log-world NAME`, `--no-behavior`; the relay:
`--no-behavior` or `RELAY_BEHAVIOR=0`).

- `turns.jsonl`: one line per agent turn of a hero or the DM, sent by the runners (`agent-player`,
  `fellowship`, `dm-agent`; `scripts/behavior-turn.mjs`) to `POST /play/behavior/turn`, accepted only from
  the runner holding that seat: seat, provider/model, turn, wake reason, the state header before (runner)
  and after (game), tool names with ok/error, narration, seconds, tokens, cost, flags (empty, repeat,
  foreign, stale, refused, scene, ...).
- `decisions.jsonl`: `src: relay` one line per `/decide` call (kind, provider, model, status, ms, error);
  `src: game` each hero's Mind entry once settled (outcome applied, late, rejected, offline, superseded).
- `world.jsonl`: a digest every game hour from `src/sim/behavior.js` (read-only, not part of `step()`):
  each company member's and agent hero's mind, link, state, place, HP, level and idle time; the share
  of game time agent / autopilot / relay mind / scripted; `companies` (#460: each company's id, name, size, agent
  minds, deaths this hour, `fellowship` for the five-place one, `ended` for one that ended with a death in it) and
  each member's and death's `company`; Table scenes and agent vs reflex turns; votes;
  DM lever pulls and refusals by caller; DM log kinds; deaths and causes; chat lines by channel (counts).
  The page sends it over the play bridge (`src/ui/player-bridge.js`, which now also connects while a
  Fellowship has relay minds); `play-headless` writes it directly.
- `anomalies.jsonl`: relay side (`scripts/behavior-log.mjs` `BD`): no tool calls for 3 turns, repeated
  narration, not English, stale claim (a fight narrated while the game says none), every call refused,
  relay failures (5 in 5 min: 429, timeouts, 5xx), two Ollama models at once, request floods. Game side
  (`src/sim/behavior.js` `BW`): idle in one place 2+ game hours outside camp, the same state 6 hours with
  no progress, reflex taking every agent turn of 2 scenes in a row, every agent vote by reflex twice,
  DM levers refused often, a danger lever pulled near a member below 35% HP, `scene-missed` (a live member's Table turn
  taken by its reflex after the wait, #515). One line per kind and seat
  per 5 real minutes (the rest counted as `heldBack`).
- Rules: no keys (key-shaped text is redacted, headers never logged), no tool results, prompts or another
  seat's text in a seat's lines, chat as counts only.
- `npm run behavior-report [-- --world NAME | --all] [--hours N]` writes `logs/behavior/<world>/report.md`:
  top anomalies with counts and examples, per-seat health, model comparison (empty-turn rate, seconds,
  tokens and cost per provider/model, relay failure rates, decision outcomes), a **Mind comparison** per company
  member and provider/model (#280, `scripts/mind-compare.mjs`: agent turns, empty/failed, Table answers, decisions,
  rejected, scripted fallbacks, p50/p90 latency, tokens, cost, digest hours on autopilot, close calls, deaths survived,
  lifetimes; "-" where a member has no data), the world digests, and **Companies** (#460, `companySection`: per company
  the most heroes and minds, game hours seen, deaths and deaths per 10 game hours for the death-rate watch, its
  members' agent turns and empty share).
- `npm run behaviorcheck` (in CI): mock runners and a timing-out relay produce every anomaly kind above on
  a headless Fellowship of silent agents; asserts they are logged and reported, that a runner cannot write
  another seat's line, keys are redacted, files rotate, the watch leaves the world unchanged, and that a
  real `npm run agent` with a lazy mock Ollama model lands its turns and its stale fight claim.

## CI observation (issue #574)

Beside the required CI (`ci.yml`, "CI ok"), four watchers (none required, none path-filtered on the required checks):
- `nightly-flakes.yml` (`scripts/flakehunt.mjs`): reruns the flake-prone checks 5 times under CI_FAST and rewrites one issue, "Nightly flake report" (check, fails/runs, `flaky` at 2 of 5, last failing line).
- `nightly-run.yml` (`scripts/nightly-run.mjs`, thresholds in `scripts/nightly-thresholds.json`): a 60 minute headless Fellowship at 8x with mock local minds (no paid API, no Ollama), the behavior report, artifacts; a crossed threshold opens "Nightly agent run failed". Mock minds make idle, no-aim and repeated-narration expected, so those are not limited.
- `screenshots.yml` (`scripts/shoot.mjs`): on PRs touching `src/ui`, `src/render`, `index.html` or `src/style.css`, headless Chrome against `vite preview` at 3440x1440 and 1280x800; artifact plus an inline comment (images on the `ci-shots` branch). Comments use `scripts/pr-comment.mjs` (a hidden marker per job; hash-guard too).
- `red-main.yml`: when CI fails on a push to main it opens or updates one issue "main is red" (label `red-main`) and comments on the merged PR; it closes itself when CI is green on main again. **An open "main is red" issue is a merge stop**: do not merge anything else until it is closed. `workflow_dispatch` with `simulate` tests it.

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
  assists; `dungeon.js` Sunken Crypt runs; `market.js` auction-house prices; `inv.js` the hero pack `a.inv` (stacks, spare gear, consumables from `USES`, quest items, supplies bought in town, `npm run invcheck`);
  `history.js` `record(a, ...parts)` per-hero event log for the dossier Log tab;
  `levers.js` the DM's world levers: a validated registry (`pull(name, params, {by, reason})`)
  with limits, cooldowns and DM log entries for people, places, danger/cleared areas, region
  conditions, price shocks, hooks and named/custom foes, plus the hooks the world reads them
  through (state on `S.levers`, `S.places`, `S.marks`, `S.conditions`, `S.wanderers`;
  drawn by `src/render/places.js`; `npm run levercheck`);
  `index.js` `init()` and `step(dt)`; `company.js` companies (#402) and, as the `slots` option
  of a company (#588), the Fellowship (#68): five fixed roles (Tank, Healer, three DPS), founding, muster, hardcore
  replacement, campaign log; read it with `slotted()`, `slotMembers(C)` in slot order, `inSlots(a)`, `slotKeyOf(a)`,
  `partySlotted(p)` (the old `S.fellowship`/`a.fellow`/`fellowship.js` shims are gone; `npm run rulescheck` guards it); `persona.js` persona sheets and backstories from
  sim facts (scripted, or enriched once through the relay) and `fellowCard` for prompts;
  `memory.js` per-member recent memories, long-term summary and companion stances;
  `council.js` party chat, proposals and votes, `lead_to`, splitting off and the all-or-none
  Crypt/raid draft; `table.js` Table mode scenes; `notify.js` events for agent-played heroes; `questlog.js` the quest log (several quests per hero, one in focus); `dmagent.js` the DM seat and its tools (#66); `staged.js` the DM agent's staged scenes and its at-the-table calls (#132).
- `src/render/`: `tile.js` the tile size (`TILE`, `U`, `ART`); `sprites.js` pixel-string sprites, `heroSprite` and the
  generated sheets; `terrain.js` per-pixel tile textures into cached chunks at TILE (or U with no terrain asset);
  `draw.js` the camera object `cam`, entities sorted by y, effects, day/night
  overlay with torch light, labels at constant CSS size.
- `src/ui/`: `panels.js` hero card, factions, chronicle, graveyard, guilds,
  top heroes, auction house, clock; `controls.js` speed, view (incl. Follow Fellowship)
  and selection; `fellowship.js` the Fellowship panel (founding, roster, sheet editor,
  campaign log), the Memory tab and the Chronicle's "Fellowship only" filter; `table.js` the
  Table mode banner and the View group's Table switch. Company-first UI (#94):
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

- XP curve `xpNeed` (60 * l^1.45, times a ramp of +80% from L10 to L16, #107), caution thresholds (hunt retreat at 45% HP, flee at 22%):
  `src/sim/heroes.js`. Hero combat totals (Health, Attack, Defense, Crit, Speed) and their
  level terms: `combatStats` in `src/sim/stats.js`; item armor/damage rates and properties:
  `src/data/items.js`. Class table `CLS`: `src/data/classes.js`.
- Mob stats (`maxhp: 25 + lvl*16`, hit `(3 + lvl*2) * MOB_HIT`, MOB_HIT 1.35 for mob level 7+, ramping from level 3), aggro and wander: `src/sim/mobs.js`.
- Boss: `maxhp` 13000, respawn 600s in `src/data/bosses.js`; hit 55-85 every 1.6s, breath every
  7s, raids need level 14+ heroes, 5+ of them or 4 with average gear 9+; raiders
  break off below 15% HP and a failed raid cools down 240s: `src/sim/boss.js`,
  `RAID_FLEE` in `src/sim/heroes.js`.
- Bounties (#67): kill-N quests are optional gate-captain bounties (`BOUNTY` in `src/sim/dm.js`, take chance .55 x greed after no adventure fits); adventure pay XP `K.PAY_XP` .35.
- Dungeon success: the `pw` formula in `src/sim/dungeon.js`; a wipe kills 40% of the party (was 55%). Webspinner and Bristleback Boar are softened in `data/bestiary.js` (tilt + aggro); Fellowship replacements seed in `company.js` (`SEED_BEHIND`=2). Duel chance .03 in `pvp.js`.
- PvP: chance duels 4% x boldness, level gap 2, range 3 tiles; nemesis spot cooldown 45s; guild assist 20%; duellers yield below 30% HP; only fallen heroes of level 12+ pass the grudge to the whole guild (lesser deaths bind their party): `src/sim/pvp.js`, `GUILD_GRUDGE_LVL` in `src/sim/heroes.js`.

## Known state

- Balance baseline (#154, 2026-11-03, 16 unseeded `npm run sim -- 120` runs on main b0a7d8b with the default Fellowship, after #269/#604/#613/#620; deaths counted without the `S.fallen` cap of 15, cause from the real death cause; minute-60 figures from 8 of them). Targets (owner, #154, replacing the old 20-40 deaths/h): background deaths 12-20 per hour over a 120-minute run, PvP under 60% of deaths (soft ceiling, report when crossed), Kragmaw killed 4-6 times per run, Fellowship deaths reported separately (governed by #269 for the Crypt and `TR.HIT`, owner's call). Measured: 11.3 deaths per hour all heroes (range 4-18.5 across runs; about 10.9 without the Fellowship's 0.8 per run), just under the 12-20 band, so it is missed by a small margin; causes 46% Sunken Crypt, 33% PvP (met, under 60%; one seed 54%), 21% mob, under 1% Kragmaw; Kragmaw dies 5.0 times per run (3-6, met; 13000 hp, respawn 600 sim seconds, limited by raid musters); median living level 12.6 at minute 60 (12-13, in the 8-13 band) and 15 at 120 (11-17), top 20 in nearly every run, about 17 alive at 14+ of 28; guild Crypt about 38 clears and 4.5 wipes per run; Fellowship L15-18 at 120 with 0.8 deaths per run (0-3, all in the Crypt crawl), 0 crawl wipes, about 14 crawl clears and 6-7 driven back of 21 runs; average hero gold about 540 (median about 300) after the smith sink; crafting about 64 items per run (alchemy 44, smithing 5, leatherworking 5, cooking 5, scribing 5) with about 330g of fees. Mobs of level 7+ hit 1.35x (ramped in from level 3, Fellowship exempt). Guild focus mix: adventure 48%, crypt 34%, pvp 15%, raid 4%; rivalries are rare (0.4 declared per run). Single lever to lift deaths into the band: the death share of a wiped background Crypt party (`dungeon.js`, now 40%), or `MOB_HIT` for L6-13 mobs; PvP stays untouched (roadmap wants less). Late-game (240 min) PvP among veterans still climbs. Fellowship replacements arrive 2 levels under the lowest living member.
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
