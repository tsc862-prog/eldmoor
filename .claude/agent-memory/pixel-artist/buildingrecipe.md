---
name: buildingrecipe
description: #763 building recipe for generated buildings/landmarks: flat palette, post-flat gate thresholds, art:preview before art:accept, kindModel ume-flux switch
metadata:
  type: project
---
- #761's four pixel-xl buildings were already footprint-sized (32x80, 96x64...); the owner said they "look awful" because
  they were front elevations, painterly detail downscaled to speckle (12-16 colours), no roof silhouette, TOWN.stone greys,
  no base. Reverted in #765. Owner: "I like the idea of generating images but that render was bad." Buildings stay
  procedural until a batch passes the new recipe.
- Recipe (#763): entries with `post.flat` go through `scripts/art/post-flat.mjs` (palette `FLAT.<style>` in palette.js:
  roof x3, wall x2, line, door; crop subject, fit on footprint bottom above `post.base` rows, mode-vote to palette, gate,
  despeckle, rim outline). Gate defaults maxColors 8, maxSpeckle .06, maxEdges .3, maxDist 30; the #761 PNGs measure
  10-16 colours, 9-14% lone pixels, ~50% edges, so the margin is wide. Grey-on-white danger: pale limestone walls clear with
  the background unless the outline is unbroken (grid misaligned fixtures leaked); fixtures in `fixtures-buildings.mjs`.
- art:accept refuses building/landmark keys without an `art:preview` record (sha of the image, 3440x1440, zoom 1);
  preview.mjs starts its own Vite (5906) + headless Chrome per key, strips all ASSET_TOWNS from the page so neighbours are
  procedural. Takes ~15 s per key.
- **Why:** owner reviews in-game, not on the contact sheet. **How to apply:** when a building batch arrives, run
  art:preview, look at both shots, then accept; ume-flux needs a FLUX Space before `kindModel.on`. See [[artreview]], [[towns]].
