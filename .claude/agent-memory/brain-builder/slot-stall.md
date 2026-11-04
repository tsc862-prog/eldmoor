---
name: slot-stall
description: "#868: turn_over at the table, tableHooks PostToolUse continue:false, RUNNER_SCENE_SLOTS, lease beats/tickets, the real leak, measured calls"
metadata:
  type: project
---
#868. **Real leak:** a slot request aborted while the supervisor slept DM_FIRST_MS fell into the immediate-grant path, which had no res check (not the queued line the issue named). Every grant now goes through grantNext; `gone` is checked after each await.

**Ending a Claude turn from a tool result:** a PostToolUse hook returning {continue:false, stopReason} stops the query with NO further model call, result subtype success with cost, session resumable (Agent SDK 0.3.316; sessioncheck section 2b through the real /mcp route). Prefer it to abort, which loses the result and its cost. tool_response is stringified with escapes, so turnOver matches `turn_over\\*"`.

Game: tableRest(a) = in sc.ids and not sceneDue. hostCall wait returns at once with turn_over (the WAIT_SCENE_MS hold of #687 is gone). paceCheck at rest passes only level 3; a.tableRest gives one soft wake after settle (hostPace clears it on any wake). finishWait(p,realOut,rest).

Supervisor: RUNNER_SCENE_SLOTS keeps one of RUNNER_CLAUDE_MAX for scene:true; beats SLOT_BEAT_MS, SLOT_LOST_MS sweep, SLOT_MAX_MS only via a beat answer (holder aborts at that moment, so the cap holds), tickets via /slot/cancel. Fellowship inner --claude-concurrency is off under the supervisor (it hid scene members from scene-first).

**Measured** (live Haiku run 2026-11-04, 96 turns, 956 tool calls, $0.59): 384 waits, only 123 zero-minute (table), 261 passed game time. 97 table episodes, so 26 repeat waits go (2.7% of calls, about $0.016) and 1804 s of slot time spent in zero-minute waits goes. Mock incident 49 -> 9 calls. The 40% wait share and the cap hits are mostly ordinary waits, not fixed here.

**Why:** owner saw Ragmar paused ~4 min with every member live.
**How to apply:** tests holding N leases on N slots need RUNNER_SCENE_SLOTS '0'. A scene spends TABLE.frameS 1.6 s in frame before due: repro timing must open the scene before the request. Long bash heredocs with backticks break the Bash tool here; write patch scripts with Write.
