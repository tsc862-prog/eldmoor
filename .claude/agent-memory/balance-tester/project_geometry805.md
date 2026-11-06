---
name: geometry805
description: 2026-11-04 PR805 crawl geometry (CRAWL_LEFT .7, GUARD_CUT .7) x40 vs origin/main 67184a3 x20, 120 min
metadata:
  type: project
---
Branch d2c14c0b: Fellowship crawl deaths 0.50/run (SE .13, 0-3), downs 0.63, runs 21, cleared 16.3, driven 4.7, wipes 0, deaths/h 10.6, PvP 38%, Kragmaw 4.95, median level 15.1, wounds 18.8 taken/run.
Main 67184a3: crawl deaths 0.25 (SE .10), downs 0.60, runs 19.6, cleared 13.3, driven 6.3, deaths/h 11.2, PvP 38%, Kragmaw 4.45, median 14.8.
**Why:** check .7 against band 0.4-0.8 after wounds/traffic landed. **How to apply:** inside band; diff vs main ~1.6 sigma. Tally of causes done by a copy of headless.mjs in logs/tmp (S.fallen cap 15 polled every 300 frames).
