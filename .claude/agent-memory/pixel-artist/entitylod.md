---
name: entity-lod
description: "#729 whole-map marks: threshold, why pawns plus 1:1 creature sprites, what the probe needs in a junction worktree, sheet loading trap"
metadata:
  type: project
---
Whole-map level of detail lives in `src/render/lod.js`: below `LOD_SC` (1 device px a world unit; Stepping whole map at 3440x1440 is .59-.63, Eldmoor 1.27, so Eldmoor never marks).

**Why this look:** tried plain coloured pips first (3x4, then 5x6 rects): creatures vanished and the map went empty, worse than the sprites at that size. What read: heroes as faction pawns (better than the sprites for telling sides apart), creatures as their own procedural sprite at 1:1 (the raw `sprite()` canvas, outlined; a wolf stays a wolf, about the size the full sprite has there). Marks go over the night wash at reduced alpha; at night they read better than sprites did.
**Why blits, not fillRects:** 7 rects a hero is no cheaper on the CPU and worse on the raster side; one unscaled drawImage from one canvas per bucket is simpler.

**How to apply:**
- Sheets load only when asked (`asset()`), so anything that stops calling `sheetFrame` moves their loading to the first close view. `warm()` in lod.js keeps asking, one hero and one creature a frame.
- Any `onAssets` subscriber runs for all 49+ sprite sheets. terrain.js now ignores non-terrain ids; before, each sheet threw away every chunk. The symptom was terrain phase 1-8 ms and 41-47 fps in follow only, and swapping the probe's sides (copy perfprobe.mjs into the base as perfprobe2.mjs, `--base` the worktree) proved it was the code and not run order. Do that swap whenever one side looks odd.
- Probe in a junction worktree: `--cache-dir logs/tmp/vite` (own Vite cache, and skips vite.config.js, whose load writes `.vite-temp` into node_modules). `npm run build` has the same write: use the Vite API with `configFile:false` and an outDir under logs/tmp.
- Box noise is large: whole runs move 2-3x (one run showed sim+ui 41 ms), so quote only same-process base/head pairs and repeat a run that looks wrong. At 1000 heroes the sim (8-9 ms) is the limit, not render (#730).
- Staging road traffic: see [[previews]]; heroes are LPC sheets while traffic figures are procedural NPC sprites (blank faces, wider), the same gap townsfolk have.
