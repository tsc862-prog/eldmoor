---
name: mirefen-pvp-dynamics
description: What actually drives PvP deaths in Eldmoor (measured 2026-10-31) and how to instrument it; read before any behaviour change that moves heroes into Mirefen faster or clusters them
metadata:
  type: project
---
Measured 2026-10-31 on 120-min headless runs (baseline before parties: 102-117 deaths, ~65% PvP, all mob deaths in Thornvale at L1-5, every Mirefen death PvP/dungeon).

- Mirefen is the meat grinder: ~0.4-0.5 duel starts per hero-minute spent there, ~0.55 deaths per duel at baseline. Anything that keeps heroes alive through Thornvale or levels them faster raises Mirefen hero-time and therefore deaths roughly linearly. Check hero-minutes by zone, not just death counts.
- Duel pairing is per pair within 3 tiles (pvp.js), so clustering heroes multiplies duel starts. Only hunt/travel/return heroes are duel-able; assist/dungeon/raid/follow/regroup are immune.
- ~30% of duel starts come from `return` (wounded or loaded heroes walking home) and ~30% are nemesis charges; deaths seed nemesis grudges, so death spikes feed themselves.
- Level 6 (first Mirefen trip) is where half of PvP deaths happen; killers are 3+ levels higher in roughly half of PvP deaths.
- `npm run sim` only prints the last 8 deaths. For balance work, write a scratch script that imports src/sim/index.js, steps 1/60 and classifies each new `state==='dead'` hero by `a.cause` prefix ("slain by a " = mob, "lost in" = dungeon, "incinerated" = boss, else PvP) and `zoneAt(a.x,a.y)`; track `state` transitions per id to count duel starts, assists and chains. Run each config twice; run-to-run variance is +-15 deaths.
