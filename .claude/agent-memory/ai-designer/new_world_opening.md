---
name: new-world-opening
description: #111 rules for a fresh world - default Fellowship at level 1, background heroes seeded 1-15 via START_BANDS, opt-out flag, which checks use it
metadata:
  type: project
---
A fresh world (init(), never restore) runs `opening()` in src/sim/opening.js (2026-11-01, #111): the default Fellowship (faction rolled per seed, autoPick of the level-1 roster, found({ai:false}), F.minds='off') stays level 1 in its hall; every other hero is seeded by `season()` with `seedLevel` from heroes.js to a START_BANDS level (30% 1-3, 36% 4-7, 24% 8-11, 10% 12-15), stratified per faction, hunting in zoneFor(level, home gate), with gear, gold, kills and a history line.

**Why:** owner wants the Fellowship to be the story from minute one, in a world that already has veterans.

**How to apply:**
- Seasoning consumes `first('lvl:...')` keys so a later level-up never claims "first to level 10" below a seeded veteran. Keep that if levels are seeded elsewhere.
- Seasoning writes gear directly to a.slots (not equip()) to avoid chronicle spam.
- The opt-out (ELDMOOR_FELLOWSHIP=0, ?fellowship=0, init({fellowship:false})) consumes no RNG, so old-start seeds match pre-#111 runs. Checks that found their own Fellowship or pick level-1 town heroes (tablecheck, campcheck, braincheck, playcheck, play-headless without --fellowship) use it; savecheck uses the new default start.
- 120-min effect is within noise (deaths ~52 vs ~47 per 3 runs); the Fellowship loses about 3-6 members per 2h. Related: [[party-rules]], [[rebalance-issue18]].
