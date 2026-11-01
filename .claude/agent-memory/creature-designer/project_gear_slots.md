---
name: gear-slots
description: Why slot gear (issue #20) uses GEAR_K=.65, how epics scale, what sim numbers validated it, and the heroes.js edits that were allowed
metadata:
  type: project
---

Slot equipment (`src/sim/gear.js`, tables in `src/data/items.js`) replaced the single `a.gear` number on 2026-11-01 (branch `creatures/gear-slots`, PR for issue #20).

**GEAR_K = .65, not 1.0.** The brief said "fully kitted at ilvl = level scores about level", but the OLD gear number was gold-throttled and actually sat at gear/lvl = 0.22 (L1-5), 0.53 (L6-10), 0.64 (L11-15) in 60-minute baseline runs. Slots fill to ~0.9 x level by themselves (shop ilvl = level, drops = mob level +-1), so a raw mean would have buffed every hero ~40%. With .65 the branch measured 0.20 / 0.48 / 0.62, matching the baseline, and 120-min deaths stayed within noise of origin/main.
**How to apply:** if someone later wants heroes stronger, change GEAR_K (one knob), not the shop or drop rates; re-run `gearratio.mjs`-style buckets against a baseline worktree before and after.

**Epics grow with their bearer.** An epic is pinned at hero level + EPIC_LEAD (3) and `refreshEpics` lifts it back there on every town visit; without this a Fang of the Old Wood looted at L3 was a dead main hand at L20 (ilvl 6 next to ilvl 11 shop gear).

**Gold piles up.** Shop cost 6*ilvl is far cheaper than the old 18*(gear+1)^1.55, and heroes buy at most one piece per visit, so L11-13 heroes carry 900-1600g (old: 200-300g). Nothing else spends gold yet except PvP loot (10%). A merchant hook `offerUpgrade(a, ilvl)` exists for another agent's travelling-merchant feature; that is the intended gold sink.

**Measurement scripts** (session scratchpad, not repo): `slots.mjs` prints sample heroes' slots and gear/lvl buckets; `gearratio.mjs` does the same for any `SRC` tree. On Windows, dynamic `import()` of an absolute path needs a `file:///` prefix. A detached worktree of `origin/main` runs the headless sim without `node_modules` (src has no bare imports).

**heroes.js edits that were agreed as in-bounds** (other agents were editing the same file at the time): `a.slots=emptySlots()` after `newQuest(a)` in `makeHero`; `gearScore(a)` for `a.gear` in `maxHp`/`atkOf`; `sellGear`+`shopUpgrade` replacing the gear-buy block in `sellAndShop`; one `rollDrop(a,m)` line in `killMob`; one `equipEpic(a,name)` line in `getEpic`. `a.gear` stays synced (`syncGear`) because `mobs.js` elite aggro, `dungeon.js` power and `panels.js` still read it.
