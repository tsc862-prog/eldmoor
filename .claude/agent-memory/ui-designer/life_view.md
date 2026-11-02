---
name: life-view
description: #389 Life view on the Fellowship sheet (src/ui/lifeview.js), Side by side / Life switch, reads tiersView only
metadata:
  type: project
---

The Fellowship sheet has two views (PR #394, issue #389): Side by side (the table, now in `.shtblw`) and Life (`.lfview`, src/ui/lifeview.js), both inside the one scrolling `.shbody`. `setSheetView`/`sheetView` are exported from sheet.js, and each view keeps its own scroll.

**Why:** the tiered memory (a.tiers) had no watcher view. The Life view reads `tiersView(a)` and never `tiersOf(a)`, because tiersOf migrates an old save and so writes.

**How to apply:** new per-member long text belongs in the Life cards, not in the sheet's table rows. Keep the data function `lifeRows()` plain for uismoke. Related: [[sheet-faces]], [[stable-panels]].
