---
name: localcheck-pacing-downed
description: #762 localcheck pacing flake cause (downed-companion urgent event from #658) and the fixture fix
metadata:
  type: project
---

Pacing section A of localcheck sometimes saw a `now` wake and a 30 min gap: a hero going down within `DOWN.REACH` 12 tiles of the town gate sends the parked test hero an urgent=2 "X is down and dying" event (`tellNear`, src/sim/downed.js). Unseeded world, so it is rare (1 in 16 runs).

**Why:** the event is correct game behaviour; the fixture, not the game, must be quiet.
**How to apply:** section A sets `DOWN.REACH`/`DOWN.SEE` to 0 while it runs and restores them. The wakes assertion prints each wake line with its reason. Do not run localcheck in parallel copies: they share logs/fellowship-runs.jsonl and the Fellowship run-record check fails. A new urgent event source near the gate needs the same treatment.
