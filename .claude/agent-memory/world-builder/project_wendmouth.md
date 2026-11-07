---
name: project-wendmouth
description: #1013 7b second chapter map (id wendmouth, 150x68, levels 5-10): sea, shared Vale names, LVL_FLOOR, first real crossing, what to keep for the next chapters
metadata:
  type: project
---

`WENDMOUTH` in spec.js: Gullstrand and Stiltmere (Vale plans, moved), Sallow Vaults entry 5, Gull Cliff Den entry 7 (a real crypt here, a prologue row in the Vale), one bridge, Wend Road closed. Hollin `north` <-> Wendmouth `south` is the first real road.

**Why:** owner: maps are part of the world; reuse the Vale's towns, rooms and creatures at Hollin's density. The old Vale stays loadable, so names repeat across specs on purpose; region ids may not (FAUNA is keyed by id): `wendstrand`, `sallowflats`, `gullhead`.

**How to apply:**
- `spec.sea {curve}` paints RIVER west of a y-curve; it reads as open sea with no render change.
- A map above level 1 needs `LVL_FLOOR` (map.js): a company that begins there is seasoned to the bottom band and gets no first delve (prologue MAX_LVL 3).
- A pier must reach the river: the town's south wall sits 4-5 rows above the river at the gate's column. The trees below it hide the jetty: a `glades` circle.
- A road to a mouth comes from the south: the mound hides anything running beside it, so route it wide with a foot point.
- Measured: 117 road tiles gate to gate is 224 game minutes on the move, about 3.7 game hours. A literal day's walk (about 700 tiles) cannot fit a map this size.
- A company camps at dusk, which breaks a long order: a check that times a walk sets out at dawn.
- Don't edit src while a Vite shot run is going: the reload blanks the page mid-run.
- Vite's cache defaults to node_modules/.vite, through the junction into E:/eldmoor. Give a worktree Vite its own `cacheDir`.
- Hollin's XP plateau holds companies at level 6-7 by minute 60; the Wendmouth pays full XP at 6 and its plateau sits at 11-12.
- Balance review on #1044: on a crawl, `hit` hardly moves "driven back" (Den at L6: 38% old, 41% after a 10% cut, 100 crawls each); `rounds` does (one more in every room 3%, one more in the middle room only 14%). Measure a dungeon with forced crawls: a company goes to its nearest dungeon, so a sim sends few to the far one.
- A staged fight must be proven to have happened: a L6 hunter ignores a L10 elite, and with the Table on a reflex fight resolves in one step. Log the lowest HP and whether the foe was hurt.
