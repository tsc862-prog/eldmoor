---
name: tiletiers
description: #177 art tiers (owner 2026-11-03: 32 px tiles now, 64 later) - TILE vs U split, tier keys in index/queue, sprite sheets, staging fixture shots
metadata:
  type: project
---
Owner decided (2026-11-03, issue #177): render at 32 px tiles now with a cheap upgrade to 64 (prefers 64's look).

- `src/render/tile.js`: `TILE` = art px a tile (32), `U` = world units a tile (16, asserted equal to world `T`), `ART`=2.
  Design choice: world coordinates, camera, labels and effects stay in U; only art resolution follows TILE. So flipping
  TILE moves nothing on screen except detail. Do not re-scale world offsets when changing tiers.
- Entities are 32x48 art (1x1.5 tiles) at any tier: procedural sprites drawn at `PROC_SCALE` 2 via `worldSprite`
  (upscaled to art res, 1-art-px outline); nameplates use `HEAD` (29 units). Heroes are now ~2x larger relative to
  tiles than before 2026-11-03; that was intended (owner's 32x48 sprite spec).
- Index/queue keys are `<id>@<tier>`, files `<kind>/<tier>/<name>.png`; keys without a tier are read as 32 (the
  owner's incoming 2026-11-03 tiles). Manifest `sizes` per tier and top-level `tiers` (lora/grid/minPalette).
- Hero sheets are drawn in FAC[0] colours (`SPRITE.key`) and recoloured per faction incl. tier shades; post-processing
  must use the same shade factors (`TIER_SHADES`) or the recolour misses.
- Gotcha: art-pixel coords of a neighbour tile are negative; use Math.floor, never `|0`, when mapping to the 16 grid.
- **How to apply:** to preview, cap script pattern: install `fixtures(man,32)` (incl. sprite sheets) plus owner tiles
  copied from E:/eldmoor/assets/incoming (read only) via setAssetPixels. Run node from powershell.exe so Chrome starts.
