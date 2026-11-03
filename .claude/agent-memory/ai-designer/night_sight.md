---
name: night-sight
description: #583 night factor in sight - sightFor(a,z) in weather.js, agent heroes only, towns exempt, which callers use it
metadata:
  type: project
---

Night shortens sight: `nightMul()` in `src/sim/weather.js` (0.6 from 21:00 to 05:00, ramps 18-21 down and 05-08 up; clock only, no RNG). `sightFor(a, z)` = `sightMul(z)` times night for `a.player` heroes outside a town rect (`inLitTown`). Used by sighthero, follow, player (`sightOf`, waryPrey), lore (visit, pickPrey, witness), notebook context.

**Why:** applied to agent-played heroes only. `sightMul` is also read by mobs.js, pvp.js, heroes.js `findMob`, narrator.js and reach.js (shout range); changing those would move the seeded world. hashcheck is unchanged, so no balance run was needed.

**How to apply:** new agent-side sight code calls `sightFor(a, z)`, not `sightMul`. Check fixtures that rely on 8-9 tile sights must set the clock to daytime first (companycheck sets noon).
