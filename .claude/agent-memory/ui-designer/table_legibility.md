---
name: table-legibility
description: #471 Table banner layout (short pixel title, chip row, body question, per-member rows) and the scene-cut label rules in draw.js
metadata:
  type: project
---

The Table banner (#471, src/ui/table.js) is: `.tt` title row (short `sceneHead()` text from src/core/scenehead.js plus the Scene map / View the crypt button), `.tchips` (ROUND, WORLD PAUSED, EVERYONE ANSWERS), `.tq` (the whole title, only when cut and the frame does not say it), `.tf` frame, then outside combat `.tmem` rows from `memberRows()` (reads S.table acts, w timers, runlink reflexMay/ownerHeld; combat keeps its `.tci` chips). The "N/5 answered · waiting for" line is dropped while rows show it; only the "no runner" hint stays. The scene view bar uses the same sceneHead.

Map, inside an outdoor scene cut only (draw.js): members get one class-coloured name on a dark plate that tries other heights before it is dropped (`lab(...,alt,pl)`), no diamond markers, no name when their bubble shows; names keep clear of bubbles via `bubbleBoxes()` (bubbles.js); a warm glow under participants at night; camp.js hides the CAMP label while S.table is set. Bubbles are opaque with a coloured edge.

**Why:** owner screenshot of a camp vote at night: cut pixel title, tiny text, piled-up labels, no per-member answers.
**How to apply:** new banner content goes in a row below the chips, never into the title row. Headless shots: stage a vote with council `propose()` (a hand-built decision with no proposal is cleared by tableHold), click "Start anyway" on the run gate, clear storage between shots.
