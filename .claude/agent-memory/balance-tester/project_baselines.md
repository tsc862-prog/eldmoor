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
