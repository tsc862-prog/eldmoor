---
name: sessioncheck-scene-flake
description: #898 sessioncheck "fresh" line / table-closed roll flake cause (real Table scene holds the roll), how reproduced, fix
metadata:
  type: project
---

`FAIL a "fresh" line rolls it at the next turn` (and "the table closed, the next turn rolls") in `scripts/sessioncheck.mjs` case 3: the headless world's level-1 hero at 8x walks into real rescue/ambush scenes ("woke (now): a scene at the table: X is going down"). `rollDue` is busy-held for a scene by design and `freshAsks` stays pending (never dropped); the mock model cannot play `scene_act`, so the table waits `liveMs` 2 min and the 90 s `until` expires. The runner is correct.

**Why:** only reproducible under load (2 of 12, 1 of 16 parallel runs of the check on a 32-core box); CI hit it 2 of 2 on one PR. **How to apply:** run that world with `play-headless --watch` (Table off); scenes there come from the proxy (`px.table`). A failing roll now prints the last 40 runner lines. Case 4 (Fellowship) can still miss turns at 16-20 simultaneous runs; not seen in CI. Related: [[check-flakes]].
