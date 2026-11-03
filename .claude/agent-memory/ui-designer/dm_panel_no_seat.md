---
name: dm-panel-no-seat
description: #560 DM panel and frame lost Open/Close seat; Restart DM, runner-stop alert line on the DM frame, notes count in the panel header
metadata:
  type: project
---

The DM is always an agent (#520). dmseat.js shows mind/budget pickers, Restart/Stop/Start DM (runners.js dmRunnerControl), link and Notes count; no data-dmseat buttons any more (dmSeatSet stays exported for the bridge/dmcheck). dmframe.js has a `.dmfalert` line fed by rungate gateMissing() (DM seat) with whyMissing; the gate banner already names the DM with Restart (#578).

**Why:** owner decision on #559: no mind active means the world pauses.
**How to apply:** in uismoke, a block that calls gate.checkRunGate with relay.runners empty must end with setRunFree(true)/check/setRunFree(false), or the gate banner buttons break the 3440 px button budget. Real-browser check: vite on a spare port plus Chrome CDP with localStorage eldmoor.playUrl pointed at a dead port so the owner's relay is never touched.
