---
name: wait-not-progress
description: #790 rules: a wait aim is never progress and ends at WAIT_MAX 240, level conditions map to a hunt, 12 h town-idle guard, refusals list the board
metadata:
  type: project
---

Owner's company sat in Murkstead 6 game days "until all five are level four". Rules added (intent.js, player.js townGuard, behavior.js):
- intentWatch no longer counts a wait order as progress; wait aims (order wait, or no order and waitish goal) end after INTENT.WAIT_MAX 240 min unless state is camp. setIntent clamps a numeric until above the cap; a text until relies on the watcher.
- `levelCond(text)` reads "level 4/four", "all five are level four"; aim saves untilLevel/untilAll; the intent tool swaps a null/wait order for a hunt on the lowest present member's `groundFor` (order has no `n`, so the 5-kill done rule does not end it).
- townGuard: `a.townIdle {at,sig,woke}` (sig = lvl, xp, kills, gold, adv, quest, held, conv, pack size). 12 h (TP.IDLE_TOWN) -> urgent ev with board + ground; intentPilot returns null for a wait order while townIdleOver, so gambit rules hunt. Pauses: hurt <60%, scene, worldHeld, open vote/meeting plan, splitUntil.
- followerFree: stale wait aim + leader out of town releases a follower.
**Why:** a wait aim restated every turn by a cheap model kept the whole company parked; autopilot never read the board.
**How to apply:** test pitfalls in townpilotcheck: the intent tool does not clear autopilot's `auto` pq (act, then filter auto cmds); restate the wait aim every <120 min or its until ends it before the 12 h guard; collect the wake event per tick (playEv is capped).
