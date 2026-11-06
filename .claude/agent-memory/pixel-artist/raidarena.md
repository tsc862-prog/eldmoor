---
name: raid-arena
description: #85 raid arena view (lair as interior, world->arena mapping, session raid record, downed raiders) and how to stage and shoot a raid
metadata:
  type: project
---
- The raid arena is a mode of the dungeon view's frame, keyed on the site's kind: `openDungeon(lairLandmark)` (kind 'lair')
  delegates state/draw/hover/list/history to render/raidview.js; the map is `buildArena(site)` in world/interior.js (the real
  lair at ARENA_K=2 tiles per world tile, so raider spots and the breath radius are true; lava = IT.WATER painted by theme
  `lair` with `crust`). gen.js lair landmarks carry `inner` and `opening` (not `mouth`: minimap treats `mouth` as a crypt rect).
- **Why:** the sim keeps no raid record (S.raidOn per faction, a.raid, boss.dmg only), so `trackRaid()` (every frame, draw.js)
  keeps per-raid party, broke-off, fell, down, rose, lowest boss share; a boss kill sends raiders home the same step, so it is checked
  before "broke off". Kragmaw has one phase and no adds by data, and the sim spawns no adds; adds shown are any live mobs in the lair ring.
- Traps: `LAIR` from world/map is a bare {x,y,name}, NOT the landmark: `openDungeon(LAIR)` would not be an arena. Use `lairs()[0]`, or
  `data-dungeon=LAIR.name` (resolved by name). `goDown` clears `a.raid`, so check `a.state==='downed'` before "broke off". Failures to die
  are `failsOf(a)` (4 with a healer near), never a literal 3. landmark:lair is 1:1 with the arena floor (2*inner*k tiles of U = 256).
- PM triage comments go stale: on 2026-11-06 a brief said no raid view existed, but #618 had merged it. Check the tree before building.
- **How to apply (shots):** `node scripts/shoot.mjs <url> <out> --sizes 3440x1440 --run-seconds 3 --raid` stages it through ?probe=1
  (`stageRaid`, `stageSlain` in src/ui/probe.js) and writes raid-3440.png and raid-slain-3440.png; no hand staging needed.
  See [[dungeon-view]], [[previews]].
- Bash tool: `python3` here is the Windows Store stub and hangs a command forever; long JS patches full of quotes go through Write, not a heredoc.
