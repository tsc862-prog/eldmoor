---
name: world-map
description: #1013 slice 6 world map screen - ui/worldmap.js, data/worldmap.js ATLAS, render/atlasart.js, what may be shown, key M
metadata:
  type: project
---

World map (#1013 slice 6): `src/ui/worldmap.js` (view `atlasView()` plus the screen, key M, Esc closes), `src/data/worldmap.js` `ATLAS` by campaign id (planned chapters have an id and shape but no name), `src/render/atlasart.js` (one pixel a tile, whole-number scale). Body-level fixed overlay, z 48, so nothing under it moves. A world with no ATLAS row, no exits and no S.maps hides the button.

**Why:** the owner asked for a reference map, not roamable; maps are chapters of a world, so the outline shows even with only Hollin built.

**How to apply:**
- Adding a chapter: a row in ATLAS is enough; a built map's roads come from spec exits. Reads only the keys of S.maps, never their contents.
- The issue's ASCII sketch and its prose disagree on Hawkwold and Wendmouth; the table follows the prose and Hollin's exit sides.
- A `button[aria-pressed="true"]` turns gold from the global rule: override it on any custom button.
- Its capture keydown must be registered before the cinema's, or Esc leaves the cinema too. uismoke's stub calls every listener, so a smoke needs its own stopImmediatePropagation.
- Browser: `?world=hollin&skip-title=1` opens the setup page; click Play the default world, then Start anyway. `?world=testlinka` skips it (a harmless setup error) and `cross(C,EXITS[0])` from an eval stages a crossing. Bash commands over about 32k characters fail with ENAMETOOLONG: use Write.
