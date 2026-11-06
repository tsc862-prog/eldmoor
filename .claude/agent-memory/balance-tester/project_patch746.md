---
name: project-patch746
description: 2026-11-04 #746 Table-fights-on-patch (ELDMOOR_PATCH=all) vs old rounds, 30 runs each at 120 min, reflex play only
metadata:
  type: project
---

Checkout E:/eldmoor-openpos @5211ba35. A (old rounds) vs B (patch, reflex), n=30 each, means: deaths/h 10.1 vs 12.0 (SE ~0.8), PvP share 45% vs 52%, Fellowship deaths 1.43 vs 1.47 (non-crawl 0.77 vs 1.13, SE 0.2-0.3), crawl deaths 0.67 vs 0.33, Fellowship mean lvl 15.96 vs 16.10, Kragmaw 4.8 vs 4.5, median lvl@60 12.4 vs 12.1.
B open ground per run: 48 scenes, 240 strikes, 9.7 spent walking (4%), 55 flanked, 0.3 free blows, 0.7 foe turns closing.
**Why:** difference in Fellowship deaths is inside noise; patch adds no meaningful lethality under reflex play. Note the crawl already uses the grid in A (strikes/flanks counted there).
**How to apply:** counting script was logs/tmp/bt/count.mjs (copy of headless with fallen/scene-kind polling). One A run died of V8 "Zone" OOM at 120 min (rerun fine) — run 3 at a time is ok.
