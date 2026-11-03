---
name: starved-company
description: #530 serveStarved in dm.js refill - starved company gets a fresh hall job first; LEAD 120 trigger; dmcheck --starve bound 360
metadata:
  type: project
---

`serveStarved(fs)` (dm.js, called first in `refill`) serves, with 2+ companies, the company in the field whose DM-unserved time passed `FOCUS.STARVE_MIN - K.LEAD` (360-120): the stale unclaimed hall job is withdrawn and `fellowHook` posts a fresh one (one a refill, neediest first), which stamps `S.dmFocus.last`.

**Why:** triggering at exactly 360 left gaps to ~420 (refill cadence ~30 game min plus hourly sampling); LEAD 120 gave worst 275 over 150 h. Busy companies and ones with an open oath job are NOT skipped (skipping them left 700-minute gaps). One-company worlds return at once: hashes (professioncheck, dmcheck, focuscheck) equal main.

**How to apply:** dmcheck `--starve` now asserts worst <= 360. The "60%" focus-companies check is deterministic per seed (98-99% across seeds); its one failure was a harness hiccup, not the value. Cost: more hall jobs and hall chronicle lines with 3 companies (DM acts ~156 vs ~100 per 150 h).
