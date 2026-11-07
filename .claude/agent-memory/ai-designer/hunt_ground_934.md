---
name: hunt-ground-934
description: #934 - agent hunts hold a ground and a clear line, the fight reflex reads the known threat rank, what stays the agent's choice, why mobs.js was left alone
metadata:
  type: project
---

Agent `hunt` orders carry `cmd.ground` (the named region, else where it starts); pickPrey takes only natives standing on it, in a `clearLine`. Named prey needs only the line. `past_flee_mark`: known rank 5 (certain death, `PK.BREAK_RANK`) breaks off at once, rank 4 at `PK.WARY_OUT` .5; `letGo` drops a walk-up to such a foe with no blow taken.

**Why:** a level 1 on Thornvale's bank saw Hoarfell across the river (night 5.4, day 9 tiles) and pickPrey, the one picker without clearLine, took a level 18; moveTo then walked it round by the bridge. a.zone followed the chase, so the hunt moved lands. PK.FLEE .15 was checked only in reach and one or two level 18 blows pass it.

**How to apply:** `standsTo` is the agent's say: a `fight` order, named prey, its own `flee_below` (`cmd.stand`). Keep reflexes out of those; danger edges stay advice. Do not read a creature before taking it: it refused rank 4 natives the agent's hunt must still take (#487 "agent orders untouched"); engage teaches the rank a step later anyway.

Mobs were not the fault: every species is territorial (no ambush outside its zone), idle strays reach 3 tiles past a border, no level 15+ home left its zone. Wander left as it is, so the seeded world holds. The Table rescue scene has `retreat`.

spreadAt's solid branch keeps a clear line from the anchor: the Highgate delve mouth sits on the bank and place 3 fell into the river and came out in Hoarfell.

Fixture trap: agent sight is 5.4 tiles at night, so a creature across a river must be nearer than that or the "never crosses" check passes on broken code; run a new check against main's source. Harness: five L1, hunt Thornvale count 2 every 30 game min, 8 seeds. Related: [[autopilot-caution]], [[paths-794]], [[night-sight]], [[check-fixtures]].
