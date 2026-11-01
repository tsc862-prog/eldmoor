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

Models per agent (set in each agent's frontmatter): Opus for `ai-designer` and `brain-builder` (shared-file behaviour and runtime model code), Sonnet for `world-builder`, `creature-designer`, `character-builder`, `lore-keeper`, `balance-tester` (bounded work checked by sims and review). Escalate a single task to Opus by overriding `model` on the Agent call; use Fable only for hard architecture.

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
- `npm run worldcheck`: builds the world specs headlessly and checks the Eldmoor map hash.
- `npm run savecheck`: snapshot/restore round trip of the sim state.

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
  `index.js` `init()` and `step(dt)`.
- `src/render/`: `sprites.js` pixel-string sprites and `heroSprite`;
  `terrain.js` per-pixel tile textures into an offscreen canvas;
  `draw.js` the camera object `cam`, entities sorted by y, effects, day/night
  overlay with torch light, labels at constant CSS size.
- `src/ui/`: `panels.js` hero card, factions, chronicle, graveyard, guilds,
  top heroes, auction house, clock; `controls.js` speed, view and selection.
- `scripts/headless.mjs`: imports `src/sim/index.js` directly (no DOM stubs),
  steps the world and prints a summary from `S`.

Data flow: sim writes `S` and emits chronicle and market events; render reads
`S` and owns `cam` (view mode and selected hero); UI reads both. `S.pinned` is
the followed hero, whose grave is never recycled. Sim modules never import from
render or ui, so the headless harness stays stub-free.

## Tuning knobs

- XP curve `xpNeed`, hero `maxHp`/`atkOf`, caution thresholds (hunt retreat at
  45% HP, flee at 22%): `src/sim/heroes.js`. Class table `CLS`: `src/data/classes.js`.
- Mob stats (`maxhp: 25 + lvl*16`, hit `3 + lvl*2`), aggro and wander: `src/sim/mobs.js`.
- Boss: `maxhp` 9000 in `src/sim/state.js`; hit 55-85 every 1.6s, breath every
  7s, raids need 4+ heroes at level 12+: `src/sim/boss.js`.
- Dungeon success: the `pw` formula in `src/sim/dungeon.js`.
- PvP: duel chance, range and level gap in `src/sim/pvp.js`.

## Known state

- In a 60-minute headless run from level 1, about 60 heroes die (roughly 60% PvP).
  A few veterans reach 14-16. No raid has killed Kragmaw yet; the boss is likely
  overtuned for hardcore rosters.
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
