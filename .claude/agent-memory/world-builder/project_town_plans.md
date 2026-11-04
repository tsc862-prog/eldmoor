---
name: town-plans
description: #793 town buildings as sim data with doors; spots at doors, standAt placement helper, why every seeded hash moved
metadata:
  type: project
---

Town plans (#793): `CITY[i].buildings` built by `planBuildings` in gen.js from data/townart.js TOWN_PIECES; integer solid `box`, one `door`, fractional `draw` (renderer, identical to the old art). Serving spots (inn, smith, quartermaster, gate, chapel) are door tiles; spec spots for those names are dropped, only `square` stays.

**Why:** moving spots changed every seeded hash (heroes stop at new points); balance-tester found 10-run means within noise of main. campcheck seed moved to 0x5eed66 and dmcheck ambush frame says "beasts and vermin" because both were seed-fragile.

**How to apply:** new towns need no building data (layout derives); a stationary hero in a box is a bug, use `standAt`. Statues (memorials SLOTS) still overlap the inn art, not fixed.
