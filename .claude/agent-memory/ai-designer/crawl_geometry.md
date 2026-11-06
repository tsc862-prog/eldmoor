---
name: crawl-geometry
description: Crawl geometry #745 - geometry.js rules, why reach is no problem at rounds:2, GUARD_CUT is not a monotonic death lever, GEO.ON proof, noise warning for crawl deaths
metadata:
  type: project
---

#745 (slice 3 of #140): `src/sim/geometry.js` is a pure resolver over a field; `crawl.js` reads it. `GEO.ON=false` or a room with no grid plays exactly as slice 2 (seeded `--run N off` signature equals main's).

**Why these rules:**
- An act that needs reach walks first and lands if the walk got there. Strict "walk this round, strike next" would waste round one of every room.
- Reach against `rounds:2` is not a problem: Crypt rooms are 7x6, stair to den 3-5, and foes also walk. Default Fellowship: 0 strikes walked. Melee-heavy party (two extra Rogues): 9% walked, and clears still rose (.66 to .79).
- Free blows settle in `outcome` (cr.free), not at the move, so pre-answers roll no dice out of order.
- Crypt foes are variants with no `beh`, so none "finish"; only site field species do.
- The Priest counts as ranged because CLS range is 2.6 (the issue listed four classes).

**Balance (the hard part):** the guard rules took crawl downs to 0 at the old .5 cut, so `GEO.GUARD_CUT` was added. It is not a clean lever: deaths per run by cut, .5: 0 (14 sims), .65: .60 (10), .7: .30 (20), .8: .50 (10), .85: .33 (15), 1.0: .30 (10) and .13 (15). Above about .8 deaths fall (a tank at full blows goes down early, the priest lifts it, the room is still won). Main itself read .64 (14) and .40 (20). 20 sims give SE .15, too coarse for a .4-.8 band: use 60+.

**Settled (coordinator decision, 2026-11-04):** `DOWN.CRAWL_LEFT` .6 to .7, GUARD_CUT stays .7. 60 sims each: .6 read .32, .7 read .45, .8 read .42 (SE .07-.09), so the three do not separate and .7 is the lowest inside the band, not a proven effect.

**How to apply:** deaths need a down at the end of a lost room times `DOWN.CRAWL_LEFT`, so look at driven-back count (fell 6.85 to 4.2) and CRAWL_LEFT or blast strength before guard numbers. Heredocs with quotes and `\'` in python patches broke twice here: patch with script files and test-import after. Related: [[crawl-positions]], [[table-rescue-saves]].
