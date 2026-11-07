---
name: hollinpieces
description: "#1013 Hollin Reach art: grange ruin, milestones, quarry dress laid up in scenery.js from the wall kit, no generation; cinema staging by moving slotHeroes"
metadata:
  type: project
---
Done 2026-11-06 with no images generated (0 GPU min, $0): the Space was RUNNING, the art loop stopped, and LPC kit pieces were enough.
- Grange ruin = `grange()` in `scenery.js`, at every `CITY[i].delve`: `tile:lpc-stone-wall-s` back wall (the south face shows masonry; `-n` is only a thin top band), `-w/-e` side stubs, `building:lpc-stone-tower/pier` stumps, drawn in 4-art-px strips of ragged height (`ragged`), flags, a procedural stair.
- Milestone = `milestone()`, rect-built stone with a chevron, placed from `ACTIVE_SPEC.exits` with `to.map` null, found from ROAD tiles, never stored positions.
- Quarry = dress kind `quarry` (pale ash-rock mound, cut blocks, cairns); spec dress edit is one word.
- **Staging**: a map-view `setZoom` shot stayed on the whole-map frame (cam said 4, picture said 1); cinema works. `slotHeroes(slotted())` (not `slotMembers`, those are slot rows) set x,y, state 'town', then `enterCinema()`; wait ~16 s; `CLIP` env crops. Harness in the session scratchpad, vite on 5902.
