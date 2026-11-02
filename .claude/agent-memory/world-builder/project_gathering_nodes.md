---
name: gathering-nodes
description: Issue #255 gathering nodes: overlay list from spec.nodes, band from region level band, fish on shore, lazy S.nodes respawn
metadata:
  type: project
---

Nodes (herb, ore, hide, fish) come from `spec.nodes` {respawn per kind in game minutes, regions:{id:{kind:n}}}, placed by `src/world/nodes.js` `placeNodes` (called by gen.js, returned as `NODES`; lookups `nodesIn`, `nodeNear`, `nodeById` re-exported by map.js). They are a list, never tiles, so the worldcheck map hash is unchanged. Placement uses `hash()` only, never the sim rng.

- Band = `bandOf(region.band)`: middle of the level band on a 5-level ladder, capped 3 (Eldmoor 0,1,2,3). Matches MATERIALS bands of #256.
- Fish sit on the shore tile (4-adjacent RIVER, node.water holds the water tile); nobody stands in the river. Cinderpass has no water so fish 0. A region asking for more than its shore can hold fails nodecheck: lower the count (Stepping sedgewater fish is 6).
- `src/sim/nodes.js`: `S.nodes={world:worldId, ready:{id:gameMin}}` created on first harvest only (so unharvested seeded worlds carry nothing), respawn is clock comparison, no tick.
- Gathering use is #257 (ai-designer). Rendering of nodes is left to pixel-artist.

**Why:** the issue forbade touching index.js/heroes.js/render and required an unchanged scripted hash.
**How to apply:** change node counts in the spec, keep new region ids listed in `spec.nodes.regions`; run `npm run nodecheck`.
