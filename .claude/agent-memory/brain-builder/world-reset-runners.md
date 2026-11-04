---
name: world-reset-runners
description: #691 world reset stops all runners with one call; exit 75 no longer restarts; resume only for same world id; offline calls bounded
metadata:
  type: project
---

- `POST /play/runner/stop-all {why?,waitMs?}` -> `{ok, stopped:N, keys, left}` (`resetAll` in runners.mjs; waits up to RESET_WAIT_MS 5 s, empties active.json). Page: `resetRunners()` / `afterReset(go)` in src/ui/save.js wrap queueNewWorld, reloadWith (Import/New), wLoad, title default world and map switch; message "World reset: N runner(s) stopped" (also kept in sessionStorage `eldmoor.reset.note` for after the reload). Relay down or runners off -> null, silent, reload goes on.
- Exit 75 is a plain stop now; MAX_RESTARTS/RESTART_MS remain exported but nothing restarts.
- active.json has `world` (browserBackend.info().worldId from the hello `worldId`; last known kept in `worldNow`). resume() skips everything when both ids exist and differ (why 'another world'); a DM runner for an open seat still starts.
- attachPlay `offlineWaitMs` (OFFLINE_WAIT_MS 10 s): an offline answer while the page is away or lists no hero waits for it to list heroes, retries once, else answers offline. Not applied when heroes are listed (hero-not-agent-played stays immediate).
- Pitfalls: bash `/tmp` is not node's `/tmp` (E:\tmp); heredoc-patching JS with `\n` inside strings mangles escapes, use Edit.
**Why:** tonight's logs showed 4-62 offline retries per runner and runners restarting into dead worlds. **How to apply:** extend runnercheck (2, 2a), upcheck (resume), uismoke ("World reset").
