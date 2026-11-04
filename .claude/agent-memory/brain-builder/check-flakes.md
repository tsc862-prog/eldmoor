---
name: check-flakes
description: #324/#378 flake hunt results - what reproduced, what did not, SAVECHECK_SEED, upcheck lock, crawlcheck PARTS line
metadata:
  type: project
---

- savecheck was fully unseeded (parent world and the --restore child); now SAVECHECK_SEED (default 324, `random` hunts, seed printed, child inherits via env). 50 random-seed runs + 40 unseeded children + load runs: no failure. #324 not reproduced; still open.
- crawlcheck --hash / --hash-off: 45+ pairs identical (seed 2, load). Children now print a PARTS line; a mismatch prints the first differing value. #378 not reproduced; hashes were stable, so no evidence of sim nondeterminism.
- upcheck "code changed" notice flake: reproduced only when two upchecks ran at once in one checkout (shared scripts/ watch, touch file). Fixed with a per-checkout lock file. UP_DEBUG_WATCH=1 logs watch events in up.mjs.
- playcheck hunt {where}: hero kept at full HP during the walk (fixture).
**Why:** parallel agent runs share the checkout. **How to apply:** never run two upchecks in one tree; use SAVECHECK_SEED=random to hunt.
