---
name: raid-arena
description: #85 raid arena view (lair as interior, world->arena mapping, session raid record) and how to stage and shoot a raid
metadata:
  type: project
---
- The raid arena is a mode of the dungeon view's frame, keyed on the site's kind: `openDungeon(lairLandmark)` (kind 'lair')
  delegates state/draw/hover/list/history to render/raidview.js; the map is `buildArena(site)` in world/interior.js (the real
  lair at ARENA_K=2 tiles per world tile, so raider spots and the breath radius are true; lava = IT.WATER painted by theme
  `lair` with `crust`). gen.js lair landmarks carry `inner` and `opening` (not `mouth`: minimap treats `mouth` as a crypt rect).
- **Why:** the sim keeps no raid record (S.raidOn per faction, a.raid, boss.dmg only), so `trackRaid()` (every frame, draw.js)
  keeps per-raid party, broke-off, fell, lowest boss share; a boss kill sends raiders home the same step, so it is checked
  before "broke off". Kragmaw has one phase and no adds; adds shown are any live mobs inside the lair ring.
- **How to apply (shots):** headless Chrome's canvas layer may not present until a rAF is awaited: before
  Page.captureScreenshot, evaluate a loop awaiting requestAnimationFrame and calling `drawDungeon` (else black canvas).
  Staging after `?continue=1` + warm-up steps can open a Fellowship raid vote scene: set `S.table=null` and hide
  `#sceneview,#tbanner,.rgate,.ralert`. Set heroes `raid/raidIdx/state='raid'`, place them at the sim's ring formula,
  `S.raidOn[f]=true`, `boss.breath` ~1 for the telegraph, push `{type:'ring',life:.33}` into S.fx for the wave. See [[dungeon-view]], [[previews]].
