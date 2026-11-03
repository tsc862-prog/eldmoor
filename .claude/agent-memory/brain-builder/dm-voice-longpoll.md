---
name: dm-voice-longpoll
description: "#680: DM voice calls are long-polled ({wait_ms}, hostDm) and the budget starts at pickup (callDeadline, PICKUP_MS 4 s cap); voicecheck numbers"
metadata:
  type: project
---
#680 (PR #689): table_call / npc_call / ruling_call take `{wait_ms}` (up to 25 s, `DM_WAIT.MAX`). `hostDm` in
src/sim/player-host.js re-runs dmAct every 150 ms until a call is pending (the page bridge and play-headless use it; the relay
WS timeout is CALL_MS + wait_ms). Voices in scripts/dm-agent.mjs ask with `VOICE_WAIT_MS` 20000; a host that answers fast falls
back to the old pollIdle/pollHot sleeps (`pollRest`).

Budget clock: `callDeadline(open, ms, seen)` in dmreflex.js = min(seen+ms, open+ms+PICKUP_MS). Table calls use scene seconds
(`c.t`, `c.seen`, `c.ep` epoch; table.js callEnd/callLeft/callSeen; a picked-up call is waited for even when the runner is
not polling); talk uses `c.wait.seen` (Date.now), rulings `r.seen`. Pickup = the first read (table_call/npc_call/ruling_call).
`TABLE.frameMs` 8000 for the opening frame and the arrival voice (call `ms` field). Fill logs gain `late: 'late pickup' | 'no answer in time'`.

**Why:** the old pollers saw calls 2-5 s late and the 6 s budget counted from the post, so Haiku answers were aborted; and three
hot pollers made ~90 calls/min (request-flood at BD.FLOOD_PER_MIN 90).

**How to apply:** measured in voicecheck: 2 polls a voice per 25 s idle, about 11 DM calls/min across a whole run with three
voices; a frame picked up 5 s late and answered after 4 s was still the agent's. An unpicked call now waits budget + 4 s
(tests that shorten budgets must pick the call up, or allow the extra 4 s). The test pitfall: keep the members' HP pinned in a
real-time test, or a level-1 member dies and an arrival scene fills calls mid-test.
