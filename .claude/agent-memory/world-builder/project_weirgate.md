---
name: project-weirgate
description: #1013 7d fourth chapter map (id weirgate, 150x68, levels 10-15): layout, Weir and Thornback numbers, the sidesStart fix, crossingcheck legs
metadata:
  type: project
---

`WEIRGATE` in spec.js: Aldermere (north bank, x0 30) and Brandhold (south bank, x0 106), regions wendreach 10-12 / oldwood ("Greywood") 11-14 / ashmarch 12-15, a ford at x=74 with a plank causeway (the road router lays bridge tiles on ford tiles), the Drowned Weir (entry 10, rooms hit x1.4 over the Vale x1.5: .48 .62 .62 .8 .91, Weighing Hall rounds 3), Weirgate Watch outpost id `weirwatch`. Exits: west Wend Road <-> Wendmouth east, north Hawk Road <-> Hawkwold east, east Kilnway (no far side).

**How to apply:**
- Weir: the Weighing Hall (boneshot x2) drove most "driven back"; rounds 3 there brought 45% to ~20% at L10-14; deaths ~0.03-0.13 a run.
- Thornback: `scale:10, hit:4, ready:['gore']`, fixLvl 14. Real-time L10 full 10/20 fights with a down, L12 1/20. hit 2.35 (Greymane's) was a pushover at these levels.
- Greymane rerun (2.35/10): real-time L7 full 10/20 downs 2 deaths, L8 2/20; Table 0 downs (round cap 12 hands the fight to the world). hit 4.2 is far too lethal in real time: left alone.
- `sidesStart` read ACTIVE_SPEC (the opening map), so a map crossed into from Eldmoor got no `S.setup.sides`; crossingcheck's "init after the switches" caught it at Weirgate. Fixed with `MAPS[MAP_ID]`.
- crossingcheck `--real-weir` legs (XLEG wend|hawk, XMAP, XROAD, XBACK env).
- dtrial needs `C.crawl` itself when a map has one dungeon (`by` only with several).
