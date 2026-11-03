---
name: autotile
description: #177 slice 2 terrain autotile contract (dual-grid corner pieces, prop variants, fixtures for previews) and how to stage fixture screenshots
metadata:
  type: project
---
Terrain asset tables in `src/render/terrain.js` (each id needs a manifest entry whose hook names the table; artcheck checks both ways):
`ASSET_TILES` base patches, `ASSET_ROAD` (road patch runs west-east, turned for north-south roads; water away from banks),
`ASSET_EDGES` (pairs grass-road, bank-water, meadow-fen, fen-ash, ash-snow; each edge / `-corner` / `-inner`),
`ASSET_PROPS` (`prop:tree|rock-<meadow|fen|ash|tundra>-1..3`, highland uses meadow).

- Pieces are a dual grid: a 16x16 piece is centred on a tile corner; the 4 tiles around it pick edge/corner/inner and a
  turn/mirror (`QUAD` mask table). Diagonals, 3 types, objects and the map rim fall back per quadrant to `blendPixel`.
- Variants: index by `hash(tx,ty,611)` (trees) / `hash(...,619)` (rocks, odds .036 via 617); a missing variant gives way
  to the next present one. Rocks exist only as assets (procedural draws none).
- With no assets the render is pixel-identical to the pre-slice code (verified both worlds); artcheck part 6 proves
  on/partial/off with fixture PNGs.
- Transition and prop manifest entries use `fit:'scale'` (a crop would cut one half); transitions minColors 2.
- **Why:** owner has not confirmed HF billing (2026-11-03); slice 2 was built on fixtures only.
- **How to apply:** to preview, install `scripts/art/fixtures.mjs` output via `setAssetPixels` from CDP (see the module
  header); fixtures are never written under assets/. Uncovered pairs seen in shots: fen-river and snow-river banks,
  mud/swamp edges (candidates for more pairs later).

## #600 more pairs (fen-river, snow-river, mud-swamp)
- A pair is: a row in PAIRS (terrain.js), a PAIR row in fixtures.mjs, three manifest entries (edge, -corner, -inner). Seeds continue after the last (1820-1828).
- Manifest palette gotchas: `BIOME.mud`/`BIOME.swamp` do not exist (use explicit hexes); the mock "transition tile" answer is green over brown, so a palette needs a dark/earthy spread or toneMatch collapses it to 1 colour (snow-river did; added ash greys).
- artcheck daily test: 2 alternates per asset exceeds the 100-call default as the manifest grows; that step now passes ART_MAX_CALLS 400.
