---
name: passability-layer
description: #792 solid-ground layer: passable.js, forest mask choice, seams for slices 2/3, camp hash move
metadata:
  type: project
---

`src/world/passable.js` (#792, PR #810): solidAt/nearestOpen/solidWhy, cached per world. Forest mask FOREST_CORE=2 (5x5 all TREE; ~11% of trees).
**Why:** radius 1 pinches paths, radius 3 is empty. Cores keep a 2-tile open ring.
**How to apply:** slice 2 should give CITY[i].buildings=[{piece,box,door}] (already read). Slice 3 must drop solid tiles from ZPTS (WALKABLE still lists PEAK). Camp `open` using solidAt moved Fellowship hashes (camps in forest cores): needed hash-change-ok. spotErr refusal text names the nearest open spot; `pull` steps `by:'scripted'` points off solid ground.
