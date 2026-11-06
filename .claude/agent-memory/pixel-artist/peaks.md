---
name: peaks
description: #895 LPC mountains - cliff atlases as dual grid, tiers, standing peaks, swapped border pairs, staging shots
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
