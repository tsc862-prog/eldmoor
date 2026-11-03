---
name: sim-perf
description: #433 sim speedups that keep seeded hashes bit-identical (stats key, homeOf memo, box-then-hypot), and the LOD flag that does not
metadata:
  type: project
---

Rule for sim performance work: a speedup must leave every seeded hash identical to main (tablecheck/professioncheck/
actcheck/focuscheck --hash, crawlcheck on both worlds). Anything that changes timing or RNG draws goes behind a flag
that is off by default.

**Why:** the owner's hard rule for #433 was "no behaviour change"; hashes are the proof.

**How to apply:**
- Distance: never swap `Math.hypot` for squared distance or sqrt (last-ulp differences flip threshold checks). Use
  `within(a,b,r)` in `sim/spatial.js`: a box reject (hypot >= |dx|) then the same hypot, so the result is exact.
- Caches on heroes: non-enumerable fields (like `_al` in actlog, `_home` in races.js `homeOf`) so saves never see them;
  compare the fields the answer reads instead of building a string key. `combatStats` compares its key fields
  (abil by identity + values) and falls back to the old joined `sig` on any difference.
- Mob sleep and staggered greetings are `LOD` in `sim/spatial.js` (`setLod`, `ELDMOOR_LOD=1`), off by default:
  idle mob wander draws gameplay RNG, so sleeping mobs changes results. Do not turn it on without a balance pass.
- Do not route npcs.js greet through the spatial index: npcsTick runs late in step(), after heroes may be created
  mid-step, which the index (rebuilt once per step) would miss.
- Measure with A/B interleaved runs (main copy from git archive vs worktree), one at a time; machine load swings
  the absolute numbers by 2x between sessions.
