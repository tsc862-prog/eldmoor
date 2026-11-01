---
name: road-encounters
description: Design decisions behind road encounters (issue #30, branch world/encounters): table, dice, spawn rules, hook lines, measured death impact and baselines
metadata:
  type: project
---

Road encounters live in `src/sim/encounters.js` (table `ENC`, spawning, `checkEncounter(a,dt)` hero hook, `encountersTick(dt)`) and `src/render/encounters.js` (`drawEncounters`, called once in draw.js before the entity loop). State is lazy (`S.encounters`, `S.encNext`, `S.encStats`) so state.js stays untouched; hero fields `enc`, `encScan`, `blessed`, `pilgrim` are added lazily so `makeHero` stays untouched.

Decided table (weights merchant 2, shrine 2, chest 3, pilgrim 2, ambush 3):
- merchant: d20 11+ bargain 3g/lvl else 4g/lvl, gear+1, once per hero per wagon, capped at the shop ceiling `gear < lvl+2` (without the cap 120 min gave ~78 upgrades and would inflate stats).
- shrine: `a.blessed=1`, consumed by one line in `strike` (+20%); 16+ also mends 30% HP.
- chest: d20 vs 10+2*zone; 5g/lvl or 25% max HP wound; removed either way.
- pilgrim: only picked up by heroes in `return`; +3 honor on arrival, d20 12+ adds a gift; abandoned after 180 game min, death, or leaving the field.
- ambush: 2-3 "Rookscar bandits" (not real mobs), d20 + floor(lvl/2) (party's best) vs 12+2*zone; XP of a zone-level kill or 35% wound + goHome. Never kills.

Spawn: ROAD tiles 12+ tiles from any gate and 7+ from the lair: 131 spots (Thornvale 12, Mirefen 98, Cinderpass 16, Hoarfell 5). Max 3 alive, one per 60-120 game min, expire after 1440. About half of spawns expire unused; Mirefen gets most traffic.

Shared hook lines (keep single-line for parallel merges): heroes.js import + `if(checkEncounter(a,dt))break;` in `travel` (after leaderOf) and `return` (after steerClear), one `a.blessed` line in `strike`; index.js import + `encountersTick(dt)` after `weatherTick`; draw.js import + one call. encounters.js imports maxHp/gainXp/moveTo/goHome from heroes.js (an ESM cycle; safe because nothing is called at module-eval time, and Rollup builds clean).

**Why:** issue #30 wanted roads to feel alive with visible dice, without new mobs or AI states. The detour is a sub-goal inside the existing travel/return states so ai-designer's state machine is unchanged.

**How to apply:** baselines on main at 2026-11-01 (120 min, 28 heroes): 116, 92, 108 (mean 105). With encounters: 105, 101, 87, 109, 121 (mean 105). Noise between runs is about +/-12%, so judge death impact on at least three runs. If the merchant ever feels too generous, raise the price before touching the cap. `S.encStats` has spawned/resolved/success/escorts/expired/abandoned counters for scratch scripts.
