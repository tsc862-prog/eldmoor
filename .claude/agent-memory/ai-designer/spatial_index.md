---
name: spatial-index
description: Rules for proximity scans in the sim: every "who is near X" loop goes through sim/spatial.js, why results are id-sorted, which scans were left brute-force, and how to re-verify equivalence
metadata:
  type: project
---

All "entities within r tiles of a point" scans go through `nearHeroes/nearMobs` in `src/sim/spatial.js` (issue #33, branch infra/spatial). Never add a new `for (const x of S.agents)`/`S.mobs` loop with a `dist(...)` check; query the grid and keep the call site's own exact `<`/`<=` check.

**Why:** scaling epic #31 wants 20-30x more entities. S.agents and S.mobs are id-ascending (pushed in creation order, only ever spliced), so sorting grid results by id reproduces the old loop order exactly: per-candidate `rnd()` rolls (mob ambush, duel pairs, assists) and first-match `break`s (nemesis, eliteSight) stay identical. Verified 0 mismatches over 8.6M index-vs-brute comparisons; 120-min deaths stayed within the 90-125 baseline spread.

**How to apply:**
- A new per-hero field or world field still goes in `state.js`; the grid is module-level and rebuilt at the top of `step()` (after recruits) because save/load serialises `S` by key and must never see it.
- SLACK (1.5 tiles) exists because entities move after the rebuild; the crypt-exit scatter (up to 1.33 tiles) is the largest same-step teleport. If a new teleport moves a hero further than that in one step, raise SLACK or re-insert the hero.
- Deliberately left brute-force (not distance scans, or tiny lists): `ecologyTick` zone presence, `zonePop`, `seekParty` town candidates, `raidCheck`/`dungeonCheck` pools, `updBoss` raid members, `fall`'s mob-target clearing, duel-case `S.agents.some(assist)`, `checkEncounter` (loops over <= 3 encounters), party fight-join/`partyMates` (party members only), `priestHeal` lists.
- Re-verify with a scratch script that steps the sim and compares `nearHeroes/nearMobs` with filtered brute-force lists after each step; a mob that respawned that step is the one expected miss (heroes scan before mobs update).
- `node scripts/scalecheck.mjs` (200 heroes, ~1040 mobs, 60 min) is the scale budget: under 3 min wall indexed. Profile showed the remaining cost is per-entity work (`updAgent`, `homeOf` string keys, `moveTo`), not scans.
- #730: grids reset per-cell counts (`grid()` in spatial.js) instead of truncating arrays; `nearestHero` answers nearest-with-pred without a list (ties to lowest id = old id-order walk); `snapHeroes`/`heroesAround` is a second grid taken at the start of a pass that moves no hero (npcsTick greet). A fully incremental index was not worth it: every entity's position must be read each step anyway.
