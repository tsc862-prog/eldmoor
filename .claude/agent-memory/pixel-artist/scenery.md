---
name: scenery
description: Vale art pass (#940 slice E) - scenery.js contract, spec `scenery` note, smoothed river and roads, staging shots and the merge order of the stack
metadata:
  type: project
---
`src/render/scenery.js` paints a world's country from a spec note (`scenery`: wash, fields, dress, bridges, head, clear); no note means every entry answers at once, so Eldmoor and Stepping stay pixel-identical. Only worlds with a note go through `scenePixel` in terrain.js.

- River and roads: a blur of the tile mask cut at a threshold (`field`, `at`) rounds the tile stairs. Water and country roads then are shapes, and `sceneGround` makes their tiles plain ground for autotile, so no bank or road piece fights the curve. Town streets are excluded by the CITY rect, not by a wall-neighbour test: that one cut every road a tile short of its gate.
- A felled tree (`felled`, ford automatically, `clear` in the note) keeps its solid TREE tile, so it must draw something (stump, bush, rock) or heroes bump into nothing.
- Nothing tall goes on walkable tiles: everything in a chunk is under the entities, so a tall piece reads as heroes walking over it.
- One sheet `prop:scenery`, layout in `sceneryatlas.js`, cut by `npm run art:scenery` (needs ELDMOOR_PACKS or assets/packs). The terrain sheet's bits strip starts at y=1696 (big) and 1730 (small); pools at 1760.
- Mounds behind mouths must be lit as a dome (normal from u,v, dither on the bands). A linear light gives hard diagonal stripes.
- Staging: sc=2 (`setZoom(2/cam.fit)`) is 1 art px a screen px; stretch `#screen` to the window for full-frame shots. `getChunk` every chunk into one canvas gives the terrain at art resolution, the best thing to review crops from.

**Why:** owner wants a third map "with the best assets/graphics yet"; the sim and map hashes must not move.
**How to apply:** a new world opts in with a note. The Vale's bridge at x=74 sits two tiles from the ford because a routed road crosses there, a world-builder question. See [[freepacks]], [[previews]], [[autotile]].
