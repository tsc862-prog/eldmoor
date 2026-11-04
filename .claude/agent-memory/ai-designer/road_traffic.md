---
name: road-traffic
description: Rules behind sim/traffic.js (#796) - why walkers follow tile lists, why only MARKET moves hashes, rescue hook through stageScene, no drawing yet
metadata:
  type: project
---

Road traffic (#796, slice 5 of #791) lives in `src/sim/traffic.js`, `S.traffic`.

- Walkers follow tile lists derived from ROAD/BRIDGE tiles, never `moveTo`. **Why:** slice 3 (#794) was changing movement at the same time; tile lists work before and after it. **How to apply:** do not route traffic through `path.js`.
- Own LCG on `S.traffic.seed`, own ids (never `S.uid`: hero ids feed hashes). `TRAFFIC.MARKET=false` gives hash equality with main; only the cart's supply moves hashes, because `price()` is global and gold is in every hash. **How to apply:** to prove a traffic change harmless, flip MARKET in the source and run hashcheck.
- Mobs are not touched by a beset (no hold on the mob), or the MARKET proof breaks. A beset ends when the mob dies, wanders 6 tiles off, or time runs out. A fixture that kills a mob must set `m.respawn`, or updMob revives it at once and it reads as "wandered off".
- Rescue hook = `stageScene(a,{by,quiet,minutes})`, so the DM's caps apply, gated on `hasLinks()`. The second argument is the game's own, so a DM tool call cannot pass it. Only a region's own creature can be cast, so a stray mob gets no scene.
- No wake for mere passing (owner watches runner cost): `on_the_road` in look and a header line only; a wake only when a walker is beset in sight or thanks a rescuer.
- `talk` to walkers, robbing and drawing are not in this slice: the issue forbids `src/render/*` and `player-tools.js`.

Related: [[spatial-index]], [[check-fixtures]].
