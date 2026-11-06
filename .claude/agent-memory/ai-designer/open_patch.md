---
name: open-patch
description: Table fights on the map patch #746 - sim/patch.js sc.fp, gate agentsDecide, tiles written to x y at once, ELDMOOR_PATCH=all for balance, what was left out
metadata:
  type: project
---

#746 (slice 4 of #140): `src/sim/patch.js`. A combat scene with a foe and an agent deciding freezes `GEO.PATCH` 9x7 of map as a grid of roomgrid's shape; `fieldOf(sc,a)` is both geometry's F and roomgrid's R, so crawl rules and words run unchanged.

**Why these rules:**
- Gate is `agentsDecide`, the issue's "scripted-only fights untouched": hashes do not move, so `npm run sim` shows nothing. `ELDMOOR_PATCH=all` (FIELD.ALL) is the only way to measure it; it measures reflex play, not agents.
- Tiles write to the entity's x, y at once, so "write back at the end" is free and the renderer needs no second truth. Kragmaw alone never moves in the world (nest is solid, tile is the nearest open one, claw reach 2 so he still touches people).
- Free blows land as beats in `take()`, before the act and after its own walk, not with the foes' turn as in the crawl: the foe's turn may already have passed, and a retreater would never pay.
- A guard lasts until its holder's next act, not to the round's end: foes act mid-order here.
- RIVER tile cost 3 = the whole walk: that is what "nobody crosses the bank in a round" means on a ford. Water and lava pass shots (`G.see`).
- The real Eldmoor map is small and busy: no 9x7 is bare, so fixtures must not assume plain ground (patchcheck scans for sites, or sets G.cost/G.cover for one test).

**How to apply:** left out on purpose: a rescue with no foe has no patch; trap saves in cover (GEO.COVER) still unread (`coverAt` is there for it); Mage read blast is crawl-only. Balance: reflex play 1.47 vs 1.43 Fellowship deaths a run, 4% of strikes walking; live agents unmeasured. Related: [[crawl-positions]], [[table-rounds]], [[check-fixtures]].
