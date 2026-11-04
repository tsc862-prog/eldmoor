---
name: dm-reserved-slot
description: #733 RUNNER_DM_SLOTS reserved DM Claude slot, hero slot requests held during prep, prep clock from first call + PREP.HARD_MS, _poll arg, test pitfalls
metadata:
  type: project
---
#733 (PR #735): the DM seat never queues behind hero turns.

- Supervisor (`scripts/runners.mjs` `/play/runner/slot`): DM kind (RUNNER_KINDS seat 'dm') leases from `dmLeases` first (`RUNNER_DM_SLOTS`, default `DM_SLOTS` 1, 0 = old shared pool, plain FIFO, not first in line). Lease ids `D<n>` vs `L<n>`; release checks both maps. GET `/play/runner` claude adds `dmSlots`, `dmUsed`. Org limit = RELAY_ANTHROPIC_CONCURRENCY + RUNNER_CLAUDE_MAX + RUNNER_DM_SLOTS (2+3+1).
- Prep hold: non-DM request waits while `play.backend.info().dmPrep.state === 'running'` (page hello `dm.prep` / play-headless info), poll 250 ms, total per request bounded by LEASE_WAIT_MS via one `t0` (runner fetch timeout is 30 s; a request outliving it is read as "no supervisor" and runs unleased). Answer `{busy, prep:true}`.
- Pace lines (pacing.mjs takeClaudeSlot): DM `waiting for the DM slot (...; RUNNER_DM_SLOTS)` / `got a DM slot` (j.dm); hero `the DM prepares the table: no Claude turn until it is done` (j.prep).
- Prep clock (`src/sim/prep.js`): `P.at` set by first counted `prepCall(tool,args)`; `args._poll===true` (dm-agent `waitPrep`) and IDLE tools do not count/start. `prepTick`: time from `at`, else `hard` at `PREP.HARD_MS` 180 s (x SHORT on resume) from `since`. View adds started/waited/hard_left.
- Pitfalls: scenewaitcheck #687 case asserts scene-before-DM ordering in the shared pool, so it runs with `RUNNER_DM_SLOTS: '0'`. tablecheck time-cap test must make one call before advancing the clock. Bash heredoc with `\'` inside a quoted python heredoc broke the Bash tool: write python to the scratchpad instead.

Related: [[slot-scene]], [[dm-voice-longpoll]], [[scene-ready]], [[ollama-ctx-and-start-gate]].
