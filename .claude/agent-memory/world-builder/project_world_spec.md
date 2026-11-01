---
name: world-spec-generator
description: The map is built from a data spec (src/world/spec.js ELDMOOR) by src/world/gen.js; how to change the world, snapshot hashes in scripts/worldcheck.mjs, reserved TESTWORLD names
metadata:
  type: project
---

Since 2026-11-01 (issue #32, scaling epic #31 phase 1) `src/world/map.js` no longer hand-codes the map: it builds `ELDMOOR` from `spec.js` through `buildWorld()` in `gen.js` and re-exports the old names (`tiles`, `zone`, `I`, `riverX`, `z2X`, `hoarY`, `ZONES`, `CITY`, `LAIR`, `CRYPT`, `ZPTS`, `LIGHTS`, `LABELS`, `zoneFor`, ...). The generated map is bit-identical to the pre-spec map.

**Why:** the world will grow 20-30x with more races, towns and zones; the owner wants places added by editing data, not formulas, and roads routed (A* `routeRoad`, bridges rivers) between named endpoints instead of hand-drawn polylines.

**How to apply:**
- Add or move places by editing the spec (regions with `band`, `biome`, `mask`; towns as rects with `gate` side; landmarks `lair`/`crypt`; roads as polylines or `{from,to,via}`; `points` for named waypoints). Change how things are painted only in `gen.js`.
- `npm run worldcheck` fails when the Eldmoor zone/tile arrays differ from the FNV snapshot in `scripts/worldcheck.mjs` (`SNAPSHOT`). Any intentional map change must update those two hashes in the same PR and say so.
- `zoneFor(level, near)` takes an optional home point and prefers the nearest matching region; without it, lower index wins. Keep the one-arg call working.
- `CITY` objects gained `race`, `w`, `h`, `gateSide`, `gateTiles`, `dx`; `CRYPT` gained `mouth` (the 3x3 rock rect, used by terrain.js to place the mouth art); `LAIR` gained `name`. Old fields untouched.
- `TESTWORLD` names (Lowmead, Greyreach, Wendmere, The Barrow Gate, The Barrow Reeve) are reserved test fixtures listed in docs/LORE.md; never reuse them for canon places.
- Still hard-coded elsewhere (out of area, candidates for later phases): `src/render/draw.js` draws the crypt label at `40.4*T` and 'KRAGMAW' at `LAIR.y-3`; `tiles.js` `W,H` must equal the spec size until phase 5 decouples them (map.js throws otherwise).
