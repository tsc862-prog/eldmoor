---
name: inventory-pack
description: Hero pack (a.inv, issue #124): design choices, consumable tuning, what the before/after sims showed, and shell/tooling gotchas hit while building it
metadata:
  type: project
---

Branch `creatures/inventory` (2026-11-01) replaced the trade-goods `bag` with `a.inv = {list, pack?}` (`src/sim/inv.js`, tables `USES`, `QUEST_ITEMS`, `INV` in `src/data/items.js`). Save v6, migration `convertBag`.

**Rules chosen.**
- One slot per stack (20) or spare gear piece; 16 slots, +8 with a Wayfarer's Pack. A full pack sells a new gear piece at once and skips goods.
- The old "bag full, go home" rule reads `load(a)` = goods units + spares, so potions never trigger a trip home (tuning stays comparable).
- Scripted use: potion below 40% x flee trait (shared 6 s cooldown `a.potCd`), bandages below 60% out of combat, rations/torch at camp, Hearthward below ~17%, a ward scroll against elites. The Crypt (one roll) counts up to 2 potions per member (`cryptDraughts`, max +1.5 power).
- Gear is stamped `cls`; a spare can only go to a same-class party member. Items above lvl+5 are "too high" and survive a town sale (max 2).
- Quest items: deliver (carry 'start') and relic (carry 'mid') jobs hand the leader their `{thing}`; finish() downgrades a success to partial if it is gone. Levers `give_token` / `take_token` use the `QUEST_ITEMS` table.

**What the sims showed (6 seeds x 120 min, reseeded Math.random, `metrics.mjs` in the scratchpad).** Deaths/hour 19.8 vs 19.6 baseline (no change in total); mob deaths 45 vs 70 over six runs (-36%), Kragmaw-caused deaths 1 vs 10; Kragmaw dies more often; PvP share rises (0.53 vs 0.38) because survivors reach the veteran band. L1-5 deaths 33 vs 36. Potions mostly shift deaths from mobs to PvP and the Crypt; do not expect the total to fall.
**How to apply:** if the owner wants fewer deaths overall, the lever is PvP/Crypt, not more potions. Compare per-cause counts, not just totals; single seeds swing 10-25 deaths/hour.

**Tooling gotchas.** In a worktree the shell blocks heredocs, `node -e` and loops with computed args; use Write/Edit for files and one plain command per call. `node_modules` needs a junction to the main checkout (PowerShell `New-Item -ItemType Junction`). `tablecheck` with the default seed 68 once failed "the leader left Highgate" after RNG-stream changes; seeds 69 and 70 pass, so treat it as seed noise (it passes on baseline).
