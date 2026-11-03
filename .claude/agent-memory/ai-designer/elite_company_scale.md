---
name: elite-company-scale
description: #502 part 2 - elites met by non-slots companies under 5 are scaled once at scene open; crawl counts already scale by crew/5
metadata:
  type: project
---

`scaleElite` in table.js `open()` (kind elite): hp x (0.4+0.12n) with a cut of 8%/level the elite stands over avg+2 (floor .6), hit x (0.8+0.04n), once (`m.scaled`). Five-slot companies and full fives untouched, so one-company hashes are identical (verified vs origin/main). Crawl foe counts already use `scaleN` (n*crew/5, min 1) in crawl.js.

**Why:** a solo or pair should not face foes tuned for five (#502).
**How to apply:** tests use `scaleElite` directly with a fake company (scripted heroes have no company, so building real pairs in companycheck is awkward). Tune via `eliteFactor`.
