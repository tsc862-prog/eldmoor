---
name: mid-mob-pressure
description: #154 slice - MOBS rows hold only lv ranges and COUNTS, so mid-level pressure = more Mirefen/Cinderpass bodies and higher lv; measured effect
metadata:
  type: project
---

mobs.js rows carry no stats (hit/hp come from bestiary.js + sim/mobs.js), so the only data levers for L6-13 are `lv` and `COUNTS`.
Change (final): lv shift only - bog 7-10, mudboar 9-12, lurker 10-13; COUNTS unchanged. Raising COUNTS made scripts/tablecheck staged scenes fail (seed-fragile untagged DM-log entry) and bought little: counts alone +0.8 deaths/h.
10-run sim 120: deaths/h 11.9 -> 14.3, L6-13 mob deaths 1.3 -> 5.0, PvP share 55% -> 34%, Fellowship deaths 1.6 -> 0.6 per run.
Counts alone (+40%) gave only +0.8/h; the lv shift is what bites.
**Why:** floor is 20/h; this slice cannot reach it alone, PvP and crypt are other levers.
**How to apply:** L1-5 mob deaths come mostly from Thornvale (Webspinner/Boar) and vary 2-5 per run between identical-code batches; do not read small moves as regressions. Measure with a per-death cause parser (S.fallen delta per step), not the headless summary.
