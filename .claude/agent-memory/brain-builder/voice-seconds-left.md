---
name: voice-seconds-left
description: #885 [ruling]/[table] lines log "left N s" at pickup; old dm.log could not settle the 1.7-2.6 s aborts
metadata:
  type: project
---

Voice lines in `scripts/dm-agent.mjs` (`tableVoice`, `rulingVoice`) now end with `, left 5.4 s` (ok) or `(left 2.1 s at pickup)` (abort). The abort timeout is `seconds_left*1000-400` (min 800 ms), so an abort after 1.7 s means about 2.1 s left at pickup.
**Why:** old logs under logs/runners/dm.log had only elapsed time, so a short budget could not be told from a slow model.
**How to apply:** after a play session grep `left` in dm.log; if lefts are short (<3 s) while budget_s is 8, look at where the game starts the call clock (long poll hold, `hostDm`) [[dm-voice-longpoll]]. Cost-report regex needs the line to end `, $x`, so keep `left` before it.
