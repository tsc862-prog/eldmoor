---
name: valescale
description: #979 Vale towns at people's scale, stepped walls, ground as shapes, wyrm sheet; the repaint race that hid scenery; staging and spec fields
metadata:
  type: project
---
- Great kit rows (spec.js TOWN_KIT, rise 0, footprint as deep as the art): a building taller than its box needs walkable-ground rules, so the box is the art. Chapel 4x6 blocks a row's lane; chapel-hill 4x5 fits a north row with the hall.
- Outline is spec `notch`; `outsideTown`/`townRing` in gen.js are the one reader (townart, townlife, scenery, passablecheck). The sim keeps the rect, so a notch tile counts as in town.
- Every door on a south edge needs an open row under it: rows are 4 deep, street 2, lane 1, ring. Check a lane joins a street (passablecheck "every door connects").
- `homeAt` on a back wall of roofs puts townsfolk outside the wall: spec `homes`.
- prologuecheck:vale is in CI only: a bigger town can leave no mouth spot (TOWN_GAP 12 from the bounds). Run it for any town change.
- **The repaint race**: onAssets repaints chunks only for ids in terrainIds. Anything else (cut town pieces, prop:scenery) that arrives after the last listed id stays unpainted, silently: bridges, fields, towers missing in the first chunks. If art is "missing", trace paintScenery before anything else.
- Ground as shapes: scenery.js soilAt, argmax of blurred kind masks with a domain warp. A straight tile run stays straight under blur alone, hence WARP.
- Peak stairs: warpedPeak reads the cliffs a few pixels off (scenery worlds only).
- Kragmaw: scripts/art/draw-wyrm.mjs draws the sheet in code (no free LPC wyrm). See [[lpccreatures]].
- Packs for cutters: ELDMOOR_PACKS=E:/eldmoor-lpcwalls/assets/packs has lpc-base and lpc-roofs. Before shots: git archive origin/main into logs/tmp/base, second vite.
- Camera clamps at the map edge, so a "centred" shot near an edge is not centred. An exception in a plan's js skips setZoom: the shot comes out as the whole map.
- **Why:** owner went to bed unimpressed (#979): towns were boxes, heroes as tall as the houses.
- **How to apply:** a new Vale town shape: kit row, recipe in packcut-buildings RECIPES, `--only` with --index. See [[lpchouses]], [[previews]].
