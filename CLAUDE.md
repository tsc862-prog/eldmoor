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

## Layout

- `index.html`: page shell and side panels.
- `src/style.css`: UI styling. Dark single-theme arcade look; Press Start 2P for
  labels, VT323 for body text.
- `src/main.js`: the whole game today, one module with section headers:
  - **world**: 80x50 tile map, zones (Thornvale 1-5, Mirefen 6-10, Cinderpass
    11+), cities Highgate (Concord) and Grimhold (Warband), roads, river, the
    Sunken Crypt entrance, Kragmaw's lava lair.
  - **terrain render**: per-pixel procedural tile textures into an offscreen canvas.
  - **sprites**: pixel-string sprites, cached canvases; `heroSprite` composes
    faction color, class gear and skin.
  - **entities**: data tables (MOBS, CLS, GOODS, EPICS), heroes, mobs, boss, guilds.
  - **chronicle**: `log(...parts)` writes the event feed. Parts are strings,
    heroes (auto-colored) or `{t, c}` spans.
  - **simulation**: hero state machine (`town`, `travel`, `hunt`, `fight`,
    `return`, `duel`, `assist`, `raid`, `dungeon`, `dead`), mob AI, boss fight,
    raid muster, PvP and nemesis checks, dungeon runs, auction-house prices,
    recruits. `step(dt)` advances everything; 1 real second at 1x = 6 game minutes.
  - **rendering**: camera (whole map / follow), entities sorted by y, effects,
    day/night overlay with torch light, labels at constant CSS size.
  - **UI**: speed and view controls, hero card, factions, guilds, graveyard, top
    heroes, auction house.
- `scripts/headless.mjs`: DOM stubs + fast-forward harness; reads state from
  `globalThis.__eldmoor` (set inside `step`).

## Tuning knobs (in main.js)

- XP curve `xpNeed`, hero `maxHp`/`atkOf`, class table `CLS`.
- Mob stats: `maxhp: 25 + lvl*16`, hit `3 + lvl*2`.
- Boss: `boss.maxhp`, hit 55-85 every 1.6s, breath every 7s; raids need 4+ heroes at level 12+.
- Dungeon success: `pw` formula in `dungeonCheck`.
- PvP: duel chance and range in `pvpCheck`.
- Caution: hunt retreat at 45% HP, flee at 22%.

## Known state (end of the claude.ai prototype)

- In a 60-minute headless run from level 1, about 60 heroes die (roughly 60% PvP).
  A few veterans reach 14-16. No raid has killed Kragmaw yet; the boss is likely
  overtuned for hardcore rosters.
- The world does not save; a reload restarts at level 1.

## Roadmap ideas

1. Split `main.js` into modules (`world`, `sprites`, `sim/*`, `render`, `ui`) with
   a DOM-free sim core, so the headless harness no longer needs stubs.
2. Save and load the world (localStorage or file export) so it persists.
3. Rebalance hardcore: fewer pointless PvP deaths, a winnable Kragmaw.
4. More world: a second dungeon, rare elite mobs, world events, weather.
5. Smarter AI: parties that quest together, healers following tanks, heroes
   avoiding enemies far above their level, personality traits.
6. Watcher tools: hero biographies, a timeline of notable events, stats charts.
