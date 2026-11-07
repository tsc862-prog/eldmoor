---
name: world-loop-checks
description: #940 slice B - checks loop over WORLDS via scripts/worlds.mjs; one snapshot table; rulescheck section 9 guards a new world's rows
metadata:
  type: project
---

A new world in `WORLDS` (src/world/spec.js) needs no edit to the checks. `scripts/worlds.mjs` (`runWorlds`, `runWorld`, `OTHER_WORLDS`, `WORLD_IDS`) is the one per-world child runner; passablecheck, pathcheck, prologuecheck, crawlcheck (`--world-child`) and setupcheck (`--stand any`) use it. Hashes and `minSpawn` live in `scripts/world-snapshots.mjs` only. rulescheck section 9 fails a world by name when it lacks a snapshot row, `docs/campaigns/<id>.md`, a FAUNA row per region (Eldmoor exempt), a first delve per town (a row naming it or a faction row with no `towns`), or its place names in LORE.md.

**Why:** hand-adding `vale` to four checks in #943 was the pattern to end.
**How to apply:** adding a world = spec + snapshot row + campaign + fauna + prologues + lore. pathcheck runs its 20-minute long run on Eldmoor only; other worlds get 5 minutes (`PATHCHECK_MINUTES`) to keep CI time down.
