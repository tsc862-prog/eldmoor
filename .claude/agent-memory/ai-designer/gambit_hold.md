---
name: gambit-hold
description: #630 gambit action `hold` - wake_me that also stops the world clock until the agent acts; limits, release paths, where it shows
metadata:
  type: project
---

`hold` (ACTS, phase both; sim/gambithold.js) = wake_me plus `S.gambitHold` (not saved) that makes `step()` stop the clock first (holdTick before tableHold). Releases: the hero's next acting tool call (playerAct -> holdAnswered), GAMBIT.HOLD_MAX_S 120 real s (expired), no live runner / hero gone / Table scene (checked each tick), owner Resume anyway (ui/holdbar.js -> holdResume). Starts only with a live runner and no Table scene; HOLD_PER_DAY 4 per hero (a.holdDay), HOLD_GAP 60 game min per rule.

**Why:** the owner worried an elite attacks before the agent's reply arrives. The clock is stopped, so nothing can hurt the hero while held; "reflexes still fire" is moot. Because game minutes freeze, the per-rule gap does not pass during a hold, so an expired hold does not re-hold at once.

**How to apply:** class presets use no hold (hashes unchanged); only the cautious preset has "foe_is elite and attacked -> hold". Anomaly `hold-expired` and digest `holds` in behavior.js. Seat info `hold:true`, brief.hold line (pacing.mjs holdNote). Tests: gambitcheck 'hold' section (clear S.table/S.tables before starting a hold in a fight, a fight can open a scene).
