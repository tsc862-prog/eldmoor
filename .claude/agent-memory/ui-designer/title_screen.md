---
name: title-screen
description: The title screen (PR #210) gates main.js start(); skip params, sessionStorage skip flag, setup page opened with back/confirmed, browser checks via CDP script
metadata:
  type: project
---

The page opens on `src/ui/title.js` (PR #210, 2026-11-02) before `boot()`: main.js wraps boot/renderer/initUI/frame loop in `start(kind)`; `titleWanted()` skips for `?continue=1`, `?skip-title=1`, `?title=0`, a pending setup for this world, or the one-shot sessionStorage `eldmoor.title.skip` set by World-menu Load/Import reloads.

- `openSetup({back, confirmed})` lets the setup page return to the title and not re-ask for the map already confirmed. Before boot, `isBooted()` is false, so the setup's export uses `exportStored(id)` (raw localStorage), not `exportSave()` (which would snapshot an empty S).
- Save summary: `saveSummary(id)` in ui/save.js uses `describeSave` (sim/save.js, read-only) plus a `<key>.at` timestamp.
- Smokes: setupsmoke mode `c` (title flows), uismoke "title screen" block (Enter/Escape via `document._ls.keydown`).

**Why:** the owner asked for New world / Continue / Load when opening the game; nothing may tick or resume behind it.

**How to apply:** any new boot path must decide whether it skips the title. For real-browser checks, headless Chrome's `--window-size=390` gives a wider layout than true 390 px. Use a CDP script with `Emulation.setDeviceMetricsOverride` (Node 22 has a global WebSocket). The script is in the session scratchpad and has to be rewritten each time.
