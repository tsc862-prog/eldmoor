---
name: baselines
description: Dated sim baselines for Eldmoor balance runs (compare future runs against these)
metadata:
  type: project
---
2026-10-31, after Hoarfell zone (Rimehound/Shaghorn/Wight) added. 120min x2: living top L8 and L20; deaths 93 and 110 (way over 20-40/h target); PvP majority. 240min x5: max level 20 every run; fallen ~220-250 per 4h; Kragmaw killed 0-9 times.
Hoarfell mob deaths: 3-8/run, all L6-7 Mirefen heroes (zone1) aggro'd while travelling; zero deaths of L15+ heroes to Hoarfell mobs.
Analytic: 1v1 vs lv21 at L16 gear L-4 costs 46-61% HP; vs lv17 at L20 costs 15-27%. Mob aggro (updMob ~line 357) ignores hero level (only m.lvl<a.lvl-3 skips).
Harness only lists last 8 deaths; a scratch tally script lives in session scratchpad (not repo).

2026-10-31 creatures/ecology (elites+road spillover): 120min x3 deaths 107/110/114 (53-57/h), L1-2 24-31, L6-9 69-78; elite deaths 0-1/run; elite kills 1-5/run (240min: 15), maxMobs 152, S.mobs len 105-120 (bounded). Same as baseline 112-133. Tally script in session scratchpad t.mjs.
