---
name: spritesheets
description: #711 sprite sheet post-processing (post-sheet.mjs) - figures found from the full model image, not the pixel grid; key check; staging a sheets shot
metadata:
  type: project
---
#711 (PR #749, 2026-11-04): sheets go through `scripts/art/post-sheet.mjs`, not the tile path.

- Do NOT read the model's pixel grid for sheets: detectGrid on a mostly white image locks onto figure spacing
  (found 24x16 etc.). Figures are cut from the full image and mode-voted straight to frame size.
- Layout = runs of the opaque profile (rows, then columns per row); wrong count or uneven widths -> kind 'flat'
  (daily/reprocess treat as rejected, raw kept). Hero sheets (palette from SPRITE.key) must show the recolourable
  key (Object.keys(recolour(1))) in half the frames. SPRITE.keyRamp adds .85/1.15 key shades that recolour maps.
- The steward generates; I only built pipeline + checks. Fixture model answers: `fixtures.mjs sheetArt(e,{rows,cols,key,block})`
  (use block 2 at the 64 tier or figures overlap).
- **How to apply:** to preview sheets in the browser, import `/scripts/art/fixtures.mjs`, `post-texture.mjs`, `post.mjs`
  and run postProcess(sheetArt(e), e, resolvePalette(...).colors, MARK.outline, {tier:32, minPalette, factors, key}),
  then `setAssetPixels`. Staging script pattern: scratchpad shot711.mjs (Play the default world, Start anyway, ctl.speed=0).
  Ports 5905 was taken; 5908 worked.
