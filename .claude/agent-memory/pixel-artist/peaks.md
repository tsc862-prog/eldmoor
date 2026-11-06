---
name: peaks
description: #989 mountains are a height field in peaks.js (atlases only the switch), what shaped them, fast Node preview; #895 notes on the LPC atlases and swapped border pairs
metadata:
  type: project
---
#895 (branch render/lpc-mountains, stacked on render/lpc-biomes, 2026-11-04).

- LPC `tiles/mountains.png` tile columns 5-7, rows 0-4 ARE a dual grid already (side down the tile's middle): one LPC tile = one corner piece. Inner corners and diagonals are unions of two pieces. Rows: rim, top, lip, face, foot.
- One atlas per rock (`autotile:peak-stone|ash|snow`, no manifest row: index entries with `source` skip the manifest). `src/render/peaks.js` owns everything; terrain.js only asks `peakPixel` first. All three atlases or none (`peakArt`), else the procedural mountain.
- Spires from the sheet (row 8) read as dark shrubs: dropped. Peaks are cut from the face tile with a code silhouette; that is what makes ranges read as mountains instead of tables.
- An island of rock or snow has a coarse edge; laying the softer ground over it (fen, grass, mud, swamp bank) is much finer: swap a/b in PAIRS, BIOME_PAIRS, fixtures PAIR and the manifest prompts together.
- **How to apply:** the `#setup` page opens late on a fresh profile: hide it with an injected style, not a one-off display:none. Manifest's last asset row has no following row: insert before it. Heredoc-free `node -e` with nested quotes breaks the Bash tool: write .cjs edit scripts into logs/tmp.
- Packs: copy `assets/packs/lpc-base` and `lpc-terrains` into the worktree (both sit under E:/eldmoor-biomes/assets/packs); ELDMOOR_PACKS is not read by any script on this branch.

#989 (2026-11-06): the atlas stamps above are gone. `peaks.js` is a height field and the three atlases are only the on switch; the ramps live in palette.js `PEAKS`.

**Why these choices:** mesas came from wide overlapping summits; a soft cap on height rounds the tips, a product (`h*rim`) keeps them sharp. Low-frequency ridged noise on height pits the surface like a potato. Small massifs need a second, finer lattice of summits or they read as gravel pads. Rock ramps switched in patches across a region seam make the very shards the issue complained of: mix the ramps by biome share instead.

**How to apply:**
- Iterate shape in Node, not the browser: call `peakPixel` over a tile box and write a PNG with scripts/art/png.mjs (about 0.15 s against 2 minutes a shot).
- Anything lazily filled must be checked for paint order: import `peaks.js?a` and `?b` as two instances and paint one backwards.
- Shadows take the painted silhouette and faces from peaks.js (`peakFaces`, `peakDirty`), so a mountain casts only once its tile is painted.
- A long heredoc with apostrophes can break the Bash tool: use Write. See [[gpuframes]], [[perfprobe]].
