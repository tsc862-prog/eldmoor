---
name: fellowship-always-agents
description: #148 hard rule - Fellowship always agent-played; how decisions wait (runlink.js link/ack gate), reflex fallback = scripted rules, 3x drop to 1x, what the checks mock
metadata:
  type: project
---

Owner hard rule (CLAUDE.md, PR #146, built in #148 on 2026-11-01): every Fellowship member is agent-played at all times; no scripted/relay mode for members (MINDS=['agent'], markPlayer refuses to unmark a living member, enforceAgents() in fellowshipTick converts old saves with a campaign notice).

**The gate is `src/sim/runlink.js`:** host sets `setRunnerLinks(a=>link)` (relay claims: connected/waiting = live) and `setReflexAck(a=>bool)` (page: alert option off, or Resume pressed). `agentLive` -> decisions wait (Table turn up to TABLE.liveMs 2 min with a nudge at turnMs; vote past PROP_MIN for COUNCIL.HOLD_MIN; adventure choice CHOICE_HOLD). `ownerHeld` (no runner, owner not asked) -> hold indefinitely; the page alert raises after 5 s (decision waiting) or 20 s (no runner at all). `reflexMay` -> reflexes decide AND playerUpd returns false so the scripted rules play the member whole.

**Why reflex = scripted rules:** with only autopilot a runner-less Fellowship sat in town at L1 for a whole `npm run sim` (autopilot only acts in the field). No host (sim, checks) means reflexMay=true, so sim results match the old scripted Fellowship (60 min: members L12-14, 2-3 fallen).

**How to apply:**
- Any new Fellowship decision must check `reflexMay(a)` before using a reflex, and list itself in `decisionsWaiting()` (table.js) so the alert can name it.
- 3x/8x: `requestDrop(reason)` sets TABLE.drop; page (ui/runalert.js) and play-headless honour it; a scene holds up to TABLE.dropS world seconds for the host, then resolves at once (never hangs). Reflex-only tables still resolve instantly.
- Checks mock links with `setRunnerLinks`/`setReflexAck`; behaviorcheck claims C/D with mock runners to keep them idle (a runner-less member would play scripted and never be "stuck").
- localBackend (play-headless) feeds the relay's links into the sim; the last localBackend() created wins (global).
Related: [[fellowship-ui]], [[new-world-setup]], [[party-rules]].
