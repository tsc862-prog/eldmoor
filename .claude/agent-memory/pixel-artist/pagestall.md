---
name: page-stall
description: #736 page watchdog, relay late-answer keep, and what really caused the "no answer in time" refusals (not the dungeon view)
metadata:
  type: project
---
- #736 evidence (2026-11-04): all 57 fellowship.log "no answer in time" were `wait` calls cut at the relay's WAIT_MS 60 s,
  because #687 lets the page hold a wait at an answered scene up to WAIT_SCENE_MS 240 s (and runners cap tool calls at 90 s).
  The dungeon view costs ~0.5 ms JS a frame at 3440x1440 (staged crawl, p99 frame 2-4 ms); no room cache was needed.
- **Why:** measure before "fixing" a suspected view; parse runner logs for the call before each refusal and its age.
- **How to apply:** `src/ui/pagewatch.js` (frameDone/gapSeen, page-stall anomalies, page digest, pageBusy label), the page
  beats every 2 s, the relay answers a held wait on a live page `held:true` and keeps late answers for a retry (LATE_MS).
  `npm run shoot -- <url> <dir> --crawl` (page `?probe=1`, src/ui/probe.js) prints the dungeon view's frame times.
  Probe staging: CRYPT.group needs `fac` and hero objects (slotMembers(C).map(m=>m.hero)), else heroSprite throws and
  the frame loop dies silently. See [[dungeon-view]], [[previews]].
