---
name: dm-reflexes
description: #561 (slice C of #520) src/sim/dmreflex.js - one DM liveness (heard/alive/gone), no seat-closed paths in arrival/staged/talk, fill logging with why slow|gone, dmShare counts arrival/opening, test pitfalls
metadata:
  type: project
---

Built 2026-11-03 on branch brain/dm-reflexes (PR "Closes #561", part of #520). #560 (panel/alert UI) ran in parallel; #562 (old saves + CLAUDE.md hard rule) follows.

**src/sim/dmreflex.js** is the one place that knows whether the DM listens. Module state only (never saved, never read by step()):
- `heard(kind)` kind 'table' | 'voice' | 'act' (every heard also stamps act). dmAct -> talk.dmHeard -> heard('voice'|'act'); arrival.sceneCall / staged.tableCall -> heard('table') (they used to keep separate polledAt).
- `setDmAlive(fn)` the host's word that a runner holds the seat. Page: ui/runalert.js through talk.js's re-export (no UI edit needed). play-headless: `dmSeatOn() && playRef.claimed('dm')`. None in npm run sim/checks.
- `gone()` clears stamps and bumps an epoch. `setDmSeat(false)` calls it. talk waits store `ep` and end at once when `goneEpoch() > ep`.
- `tableLive(sc, missMax, pollMs)` = misses < max && (table polled within pollMs || alive). Used by arrival (opening/arrival) and staged (now ANY staged scene, not only by==='dm-agent').
- `fillWhy(c)` = c.t > 0 ? 'slow' : 'gone' (callWait adds dt to c.t only while waiting).

**Removed seat checks:** arrival/staged/talk no longer read S.dmAgent.seat; a world nobody polled never waits, so hashes are identical (hashcheck all same). talk dmBudget checks stamps/alive BEFORE today() so a no-DM world never touches S.talks.day.
Kept: dmAct refuses with the seat closed (a host-less world has no seat; wording now "a played world opens it; headless --dm"); dreamTick listens only with the seat open; behavior seat state 'closed' for headless.

**Logging:** every fill has detail `{fill:true, why}`: arrival resolve, staged resolve (outcome fills are now logged too), talk speakAs by 'scripted' (why = c.wait ? 'slow' : 'gone'). behavior shareOf counts dmlog kind 'agent' with `call && scene && staged==null` into dmShare.kinds.table (arrival/opening); staged still counts from S.staged.stats.

**Alert/pause:** nothing new needed in UI: rungate (#578) already holds the world when the DM runner is gone and plays the alert cue; Resume anyway -> the reflexes fill since nobody polls.

**Tests:** tablecheck --arrival (busy runner waited, gone -> fill at once, slow/gone logged, seat stays open); tablecheck --talk (gone mid-wait -> reflex now, logged slow); dmcheck --opening 'silent' replaces 'closed'; behaviorcheck 6d counts arrival/opening fills.
Pitfall: a scripted talk answer in the middle of dmcheck's main run rolls RNG and shifts later seed-sensitive checks (staged "last slot" and hear failed). Put extra talk tests in tablecheck --talk (a child with its own world) instead.

**After merging main (#582/#587/#584):** the fireside and debrief (sim/fireside.js, #571) voice through arrival.js's exported `voiceLive`/`resolveCall`, so they follow tableLive and log `fill/why` with no extra code; dmShare counts them as table slots (scene 'fireside'). tablecheck --fireside asserts the logged fill. dmAct keeps the `_pool` recall line from #553 before the seat refusal.
