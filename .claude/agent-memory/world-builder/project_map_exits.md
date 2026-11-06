---
name: project-map-exits
description: #1013 slice 1a (PR 1019): spec.exits format, EXITS, setWorld/MAP_ID, onWorld in kept.js, TESTLINK fixtures and MAPS table
metadata:
  type: project
---

Exits live in spec.exits (at | edge), gen.js returns EXITS, map.js exports live `let` bindings plus MAP_ID and setWorld; MAPS = WORLDS + TESTLINK (testlinka, testlinkb) is the table checks loop over. worldcheck validates exits for all of MAPS and doctored cases.

**Why:** the in-page map swap design on #1013; hashes did not move (const to let is safe).
**How to apply:** a real second map needs a WORLDS row, snapshot row, unique names. Vale exits are not painted yet: need lore names and a null-destination rule (worldcheck currently demands a real far exit). setWorld does not re-apply applyFauna (slice 1b).
