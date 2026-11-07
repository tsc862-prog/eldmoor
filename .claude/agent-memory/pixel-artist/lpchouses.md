---
name: lpchouses
description: #830/#940 kit rows: houses, harbour inn, long hall, palisade, streets through the plaza; why house is not in TOWN_PIECES; staging Vale towns
metadata:
  type: project
---
render/lpc-houses (2026-11-05), stacked on render/lpc-walls, needs #947 too; the owner judges by shots.

- A plan row's `kit` (spec.js TOWN_KIT key) is the art name: `building:lpc-<style>-<kit>`. A plain piece's key equals the piece, so its id is the old one. `ownShape(b)` in townart.js = a row other than the piece's shape: no generated asset fits it, the fallback is `plainHouse` (pieceart.js) drawn to the box. Every Vale building has `kit`, which is also how the renderer tells a plan's own town: Eldmoor and Stepping have none, so nothing of theirs moves.
- `house` is NOT in data/townart.js TOWN_PIECES: planBuildings puts every row of that table in every default town, which would move the Eldmoor and Stepping hashes.
- Rise 0 needs depth: a 3-deep footprint (96 px art) holds a full door; a 2-deep one only a 33 px door. Rise 1 only on the north row. Houses against the south wall work if one free row is left in front.
- Palisade is a wall set, not a style: spec town `wall:'palisade'`, ids `tile|building:lpc-palisade-*`, all boards from bridges.png stood on end. A timber town of another name keeps its stone ring unless the spec says so.
- Spec `ground` streets stay road through the plaza (`lane`), with a kerb; a palisade town is decked throughout.
- Vale tile hash did not move with new houses (the solid grid is not in it); Gullstrand's inn moved and passablecheck still passed.
- **Why:** owner wants towns to feel lived in, not six layouts of one kit.
- **How to apply:** new shape: a TOWN_KIT row, a recipe in RECIPES, `npm run art:lpc-buildings`. A heredoc with quotes in Bash can fail on long Python: use Write for edit scripts.
- Staging: `?continue=1&world=vale`; clip by cam.offX/offY, because towns on the map's edge clamp the camera. See [[lpcbuildings]], [[lpcwalls]], [[previews]].
