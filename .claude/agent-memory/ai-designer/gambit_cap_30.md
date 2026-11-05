---
name: gambit-cap-30
description: #779 gambit cap 30, presets untouched, a.gambitWrote counts rules heroes add themselves (and use_ability ones) for the behavior report
metadata:
  type: project
---

GAMBIT.MAX is 30 (presets ~20, none with use_ability). `setGambit` adding a NEW rule bumps `a.gambitWrote {n, ab}` (ab = then use_ability); editing, moving, toggling or resetting never counts. The hourly digest carries `wrote`/`wroteAb` per hero in `gambits`; the report's Gambits table shows "rules written / with abilities" (latest total, not summed).

**Why:** the owner wants to see if agents ever add ability rules before any class default casts them; a counter survives the 30-entry edit history cap.
**How to apply:** if the count stays 0 after a few sessions, a later issue may add a preset rule; hashcheck's autopilot row must not move. Mind comparison column not added (Gambits table only).
