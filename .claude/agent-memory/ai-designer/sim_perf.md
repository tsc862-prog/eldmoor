---
name: sim-perf
description: #433 and #730 sim speedups that keep seeded hashes bit-identical (stats key, call counts, grids, greet snapshot), how to measure, and the LOD flag that does not
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
  mid-step, which the index (rebuilt once per step) would miss. Since #730 it uses its own grid taken at npcsTick start.
- Measure with A/B interleaved runs (main copy from git archive vs worktree), one at a time; machine load swings
  the absolute numbers by 2x between sessions.

#730 (second pass, about 28% off the step at 100 heroes on Stepping):
- `--no-turbo-inlining` profiles inflate small hot calls (combatStats looked like 16%); the real marginal cost of a
  combatStats hit was ~150 ns (measured by calling it 3x). Trust A/B timing, not self time. Inlined profiles fold callees
  into `step`/`updAgent` self time.
- What paid: fewer combatStats calls (updAgent prelude one lookup; priestHeal one maxHp per member), cache entry on the hero
  (`_cs`), homeOf only in the cases that use it, `nearestHero` (no list) for nearestFoe, grids that reset counts instead of
  `length=0` (truncation freed and regrew the cell arrays every step), greet via a grid taken at npcsTick start
  (`snapHeroes`/`heroesAround`: heroes do not move inside npcsTick, so the late-step concern does not apply), `blk` cached
  on the mob (`_blk`), hireTick builds no list when nobody is hired, chatTick counts before filtering.
- Rejected: a cached key count for the `Object.keys(p.met).length>120` / heroElite checks. Any writer outside npcs.js
  (a test filling the maps did) leaves the count stale and the cleanup never runs. A cache is only safe when its check
  reads the inputs.
- A combatStats version counter was rejected: checks and the probes write a.lvl/a.abil/slots directly, so a counter would
  serve stale stats where the field compare rebuilds, and hashes would move.
- Full-state comparison scripts must seed Math.random too: the market supply drifts with Math.random, so two runs of
  main differ in gold after a few thousand steps. Exclude worldId/world, nothing else.
