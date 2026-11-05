---
name: errand-wait
description: How #727 town errands fit #790: an errand is a capped wait that earns nothing; townGuard outranks errands and the arrival hold
metadata:
  type: project
---

Town errands (#727/#732) merged under the rule of [[wait-not-progress]]. The rule: #790's guarantee wins wherever they meet.
- An errand is {kind:'wait', errand, town}: untilAt = min(INTENT.ERRAND, WAIT_MAX) from now. Only running it (errandTool) moves I.prog; the wait itself does not, so an unrun errand is stale at 2 h, still held to its end.
- A walked errand counts its cap from arrival (I.waitAt, waitFrom()), and a far until is cut there: the walk was not a wait.
- A level condition beats errand words: intent swaps the wait for the hunt, so "Rest at the inn until level four" hunts.
- townIdleOver outranks both the wait order and leaveHeld; intent and list_jobs are act:false and leave the guard's sig alone, so restating cannot reset it. talk does change the sig (a.conv) and any acting tool resets the idle clock: an agent that really keeps acting is deciding, not stuck.
- Hold rests do not end at full health, so waitStep stops each rest at the aim's end, the cap and the guard, or the guard would lag up to an hour.
- errand-unacted judges a stale wait errand when it ends, not when it goes stale.
**Why:** the owner's company sat six game days in town; #802 fixed that and a town errand must not reopen it.
**How to apply:** any new reason to hold a hero in town must yield to townIdleOver. Test pitfalls: untilAt is rounded, so allow +1 against WAIT_MAX; a hero reused across townpilotcheck sections hits INTENT.PER_DAY, clear a.intentDay; a test of the guard should not fake the idle clock after the start.
