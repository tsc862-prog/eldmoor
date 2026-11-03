---
name: scene-map-polish
description: #536 scene map polish - docked banner (.screen.scin), roomBox/settingScale whole-number crop, quote-only bubbles (core/spoken.js), answer marks, narration list, short option labels
metadata:
  type: project
---

#536 (owner review of a staged meeting in a Highgate chapel) shaped the indoor scene map:
- Placed people are named without their role at the source: `C.name=w.name; C.role=w.title` in sim/staged.js, levers create_npc effect `{name, title}`, the DM's npcs list `name`/`title` apart. Old lines are cleaned in the UI with `unrole(text, [{title,name}])` from `src/core/spoken.js`.
- Bubbles carry only spoken words: `spokenOf(text, name)` (quotes, else speech unless it reads as prose). Used by sceneview `track()` and drawSetting for `e.bubble`.
- The banner docks beside the map while an indoor scene is open: `#screen.scin` (sceneview toggles it), CSS right column, below the map at <=700px; `--scbar` = bar height. `roomBox()` gives the room the larger area left of / above the banner; `settingCrop/settingScale` crop the VOID margin and use whole-number scales (3x desktop, 3x at 390 px dpr 2).
- `S.table.narr` is one slot; the banner keeps the last 4 per scene in `narrLines()` (ui/table.js), skipping the frame.
- Option labels: `shortLabel(sc,k,text)` (DM label cut by `cutWords` at a word, else SHORT per staged key), full text in `title`.
- Bar = `barStatus(sc)` (answers n/of or whose turn + timer) and the place; the who list only outdoors.

**Why:** the owner judged the first scene map "close, but could use more improvement" (2026-11-03 review).
**How to apply:** browser checks of the scene map must not import `/src/render/sceneview.js` from an eval after editing files under a running vite (HMR `?t=` makes a second module instance with its own #sceneview on top: a black map). Let the page's own sceneTick open the view. Screenshot script: scratchpad g536/shot.mjs. Item-to-pack movement waits for #524 give_item. See [[table_legibility]], [[stable_panels]].
