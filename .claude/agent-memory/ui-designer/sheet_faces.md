---
name: sheet-faces
description: #376 member portraits in the Fellowship sheet column headers; per-hero canvas Map kept across table rebuilds
metadata:
  type: project
---

The sheet (src/ui/sheet.js) rebuilds its whole table on a signature change, so faces live in a module Map
(hero id -> canvas `.shport`) reused across rebuilds and redrawn only when `portrait(a,mode)` returns a
different cached canvas (`cv._s`), same as frames.js. The mode (dead/ghost) is part of the sheet signature.
sheetRows() carries no face. The roster faces in fellowship.js were a separate issue (#379).

**Why:** issue asked for redraw only on key change and sheetRows() unchanged.
**How to apply:** any other rebuild-style panel that adds portraits can reuse this pattern. See [[stable_panels]].
