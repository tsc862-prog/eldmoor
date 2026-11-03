---
name: towns
description: #177 slice 3 towns and landmarks contract (townart.js pieces, styles by faction in src/data/townart.js, ids, fixtures, Node raster check, mock answers)
metadata:
  type: project
---
- `src/render/townart.js` draws towns and landmarks into terrain chunks (terrain.js `decorate` calls `drawPlaces`). Hook table
  `ASSET_TOWNS`; ids `building:<style>-<piece>` except the straight wall `tile:<style>-wall` (kind tile so post-processing
  crops it seamless; `pieceId()`), plus `landmark:crypt-mouth`, `landmark:lair`. Any of them loaded flips chunks to TILE res.
- Data `src/data/townart.js`: `TOWN_STYLES` (stone, timber), `FAC_STYLE` by faction index (wraps), `TOWN_PIECES` boxes in an
  11x9 east-gated town, mapped per gate side like gen.js spotAt; walls/corners/gate turned by quarter turns (drawn as a north
  wall, outside up). Colours in palette.js `TOWN`/`LANDMARK`.
- With no asset the drawing is byte-identical to the pre-slice decorate (verified over every chunk of both worlds at U and TILE
  by a Node raster). Smithy, chapel, inn, board, walls, lair have no procedural building ("none" fallback).
- artcheck part 8 (`--towns` child) uses its own tiny Raster ctx (function-wrapped class: the child dispatch runs before the
  class line). The mock HF server answers town prompts by words (`town wall|town gate` -> stone, `one building alone` -> house);
  the green grass mock collapsed stone palettes to 1-2 colours (flat), so keep those words in town prompts.
- **Why:** owner (2026-11-03) wants generated art with procedural fallback; slice 3 built on fixtures only.
- **How to apply:** preview with `scratchpad shoot.mjs`-style CDP script: setAssetPixels the ASSET_TOWNS fixtures, setZoom(4),
  cam.camX/Y = tiles*16, S.gameMin to noon. See [[previews]], [[autotile]], [[tiletiers]].
