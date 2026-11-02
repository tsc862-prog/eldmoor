---
name: dm-fellowship-first
description: #165 DM priorities Fellowship first - dmfocus.js, dm_status fellowship_needs/change, event cadence, scripted board rule, reserved share, dmFocus digest, pitfalls
metadata:
  type: project
---

Built 2026-11-01 on branch ai/dm-fellowship-first (PR "Closes #165"). Owner principle: the DM serves the Fellowship first, then the world (also a Hard rule in CLAUDE.md).

- src/sim/dmfocus.js is the one module that knows the Fellowship (imports only state + map): focus() {ids, town (hall row), zone, zones, members, busy}, touches(e), countable(e), tally(e) (called from dmlog()), pullTouches, reserveOf, focusStats. S.dmFocus {acts, fellow, day}. Countable DM action = hooks entry with a post, applied lever with advId null, staged scene frame (not "met").
- dm_status: fellowship_first, fellowship_needs {summary, where, items, quiet, share_of_dm_actions}, fellowship_change (signature string) sit before table/world keys. The DM seat has no /play/pace (hero route, 403), so the event cadence rides dm_status, which waitTurn already polls.
- Runner (scripts/dm-agent.mjs): eventDue(st,{sig,gm},ev) -> extra turn between evenings; EVENT_MAX 3 a game day, EVENT_GAP 120 game min; sess.lastSig/sess.ev saved; withDmFellowshipOrders patches old sessions; fellowNow(st) opens every turn prompt.
- Scripted DM (dm.js): makeHook for the hall town posts fellowHook (oath of a member, nearest elite within hi+2, else a job in the region they ride if the band fits) whenever no open hook there concerns them; refill fills the hall first; outlying boards keep K.FLOOR 1 unless fo.busy. Effect in sim 60: post_hook 349 -> ~240, adventures started ~280 -> ~190, share of DM actions on the Fellowship ~63%.
- Reserve: levers.js day.nf counts non-Fellowship pulls per lever; refused with "kept for the Fellowship" once perDay - reserveOf(perDay) used; staged.js STAGE.RESERVE 1 (day.nw counts stagings away from members).
- Behavior digest: world rec dmFocus {acts, fellow, share}; report line; behaviorcheck assertion.
- Pitfalls: python on Windows reads/writes cp1252 - a non-ASCII char I inserted (the right quote) became an invalid UTF-8 byte; use node/Edit for edits with such characters (utf8check.cjs approach: decode fatal). tablecheck section 4 ("musters with ... leading") is state-fragile: a Crypt order waiting in S.fellowship.wait sends them down at the gate; the check now clears it. `headless sim` is unseeded Math.random, so compare totals, not exact numbers. The agent sandbox refuses node -e / sed with runtime-built programs that mention git-like forms; use Edit or script files.
