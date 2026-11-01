---
name: request-throttle
description: #117 request flood fix - src/sim/throttle.js (speed-aware virtual clock, say caps, writing backoff, rpm/failure log), memory coalescing, ratecheck numbers
metadata:
  type: project
---

Issue #117 (owner's relay log: 514 requests in three 20 s bursts, 320 failed). Sim-side fix in `src/sim/throttle.js`, hooked from brain.js (`ask`, `askRelay`, `brainLine`, `brainTick`), memory.js, fellowship.js (`enrich`), camp.js, table.js, and one line in the Fellowship panel.

- Throttle clock `vt` = sim seconds / world speed ("real seconds at the player's speed"), advanced by `brainTick`; speed comes from `TABLE.speed` via `setSpeedSource` (table.js). Caps and backoff use `vt`, so a headless run at 8x measures what the browser sends.
- `sayOk(hero)`: 20 vt s per hero, 3 vt s global, x3 at >=3x; used by brainLine, camp and Table lines (denied = scripted text). Writing-kind backoff (`fail`/`blocked`): 15 s doubling to 300 s per hero+kind, plus a global pause (30 s doubling to 240) when the error text mentions 429/rate/overload. askRelay now treats {error} and HTTP >=400 as failures (before, it only returned null).
- Memory: identical lines (same text and kind) in `recent` fold into one with `c` count; model summaries coalesce in `M.pend`, at most one per member per game day (`M.sumAt`), none at >1x except the fold that opens a new day. Scripted digest still runs every fold. enrich skips sheets with `src==='model'` or `edited`; restore never calls enrich.
- `npm run ratecheck` (children per phase, in-process counting fetch via `brain.setFetch`): 6 game days at 8x, Fellowship with relay minds. Before (HEAD f056118): 167 requests = 55.7/min (say 68, memory 55); with 429: 156 = 52/min. After: 74 = 24.7/min (say 10, memory 20); with 429: 44 = 14.7/min. Bound 30/min. Remaining volume is decisions (townPlan, cryptCall) which are not throttled, only the existing 60 s offline rule.
- Gotcha: `init()` does not reset S; one process = one world, so multi-phase checks spawn children. The Bash tool in worktrees refuses commands that run `cd` into another worktree or pipe generated code; use absolute paths and the Write tool.
