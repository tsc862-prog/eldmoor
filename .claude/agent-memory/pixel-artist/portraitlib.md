---
name: portraitlib
description: #710 portrait library - ids, pick by hash, 5:6 frame resample, fixture faces, staging a frames/sheet shot
metadata:
  type: project
---
#710 (epic #177 slice 5a): portrait() in src/render/portrait.js draws a library face when the index has one, else the
#367 code face. Manifest entries for portraits were deliberately left out (follow-up after PRs #671/#704 merge).

- Ids `portrait:<race>-<cls slug>-<sex letter>-<nn>`, townsfolk `portrait:townsfolk-<role>-<nn>`; `assets.js`
  `parsePortraitId`, `portraitAssets(race, cls?)` (sorted, memoised, cleared on index change). Heroes have no sex
  field, so the pick pools all sexes of a race x class.
- Pick: `libraryFace(a)` = hash(seedOf(a)) over the pool (class, then race, then null). Entries still filtered by TILE tier.
- UI boxes are fixed 30x36 CSS (style.css, ui-designer's). A 64 px face is put in a 5:6 frame (backdrop on top, bottom-
  aligned) and area-resampled to 30x36 x devicePixelRatio (`libraryPixels`). Looks soft; bigger boxes would be a UI change.
- terrain.js onAssets ignores `portrait:` ids (otherwise every face load repainted all chunks).
- **How to apply:** staging: scratch vite on 5900, `?continue=1`, `setAssetPixels` with `scripts/art/fixtures.mjs`
  `portraitFixtures(ids)`, then `ui/sheet.js openSheet()`; clip `#frames`, `#sheetov .shtbl`, `#fellowship`. Node CDP
  script run through powershell.exe (see [[previews]]).
