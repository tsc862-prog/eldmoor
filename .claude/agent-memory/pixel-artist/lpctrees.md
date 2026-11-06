---
name: lpctrees
description: #834 LPC rocks and whole canopy trees - decision (multi-tile, painted in chunk, redrawn over entities), cutter, staging gotchas
metadata:
  type: project
---
#834 (PR #883, branch render/lpc-trees-rocks). Rocks: `prop:rock-<biome>-1..3` via `packcut.mjs props` (recoloured per biome). Trees: `prop:canopy-<biome>-1..3`,
96x120 whole trees, table `ASSET_CANOPY` in terrain.js; anchors on TREE tiles with (tx+ty) even, painted into the chunk (`paintCanopy`, rows below and columns
beside count), `treesNear` + `drawTree` in draw.js redraw trees rooted below an entity over it (sorted in the ents list); company members and the selected hero
get a 45% see-through redraw. Full-alpha redraw is exact; a translucent tree redraw leaves blotches where trees overlap trees (tried, rejected).
- Cutter needs the packs folder: `ELDMOOR_PACKS=E:/eldmoor-packs/assets/packs` (not in the worktree).
- artcheck passed the 100-asset mark: 2 alternates per asset exceed one month of $2.00, so the test splits the alternates over two months.
- C: ran out of space (a chrome profile per shot, ~40 MB each); point TEMP/TMP at a folder on E: for checks, and reuse one profile dir for shots.
  Deleting my own scratch profiles was blocked by the permission classifier; leave the cleanup to the owner.
- Parallel `npm run artcheck` runs into one log file corrupt it; one at a time, a new log each.
