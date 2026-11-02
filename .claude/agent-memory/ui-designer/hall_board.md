---
name: hall-board
description: #334 Hall board block in the Fellowship panel; hallHooks/hallBoard in sim/dmfocus.js shared with pace.js's hall brief
metadata:
  type: project
---

The Fellowship panel shows a "Hall board" block under Open threads (`hallView` in `src/ui/fellowship.js`), one row per
open hook on the hall's board that concerns the Fellowship: title, then region · Lv band · posted day · whose oath / which
elite · "by DM agent|scripted DM|town board". Empty state: "No job for the Fellowship on the hall board."

**Why:** the owner could not see which jobs the DM keeps waiting for the Fellowship. The watcher may see who posted a
job; hero-facing text (pace.js `hallBrief`) must never say it.

**How to apply:** the selection lives once in `hallHooks(town, f)` in `src/sim/dmfocus.js` (pace.js uses it too);
`hallBoard()` gives the watcher rows. Change the filter there, not in two places. uismoke injects fake hooks into
`S.adventures` and restores them.
