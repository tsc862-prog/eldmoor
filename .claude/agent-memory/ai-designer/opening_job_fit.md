---
name: opening-job-fit
description: #1016 - jobbar.js is the one reader of a job's level bar; opening first move, council job proposals and hall posting honour it only in hosted worlds
metadata:
  type: project
---

`src/sim/jobbar.js` (`jobBar`, `jobShort`) is the one reader of the level a posted job asks: `max(K.MIN_LVL 4, template lvl)`. `player.js` jobFit, `arrival.js` firstMoves(town, C), `council.js` propose (job_id) and the DM's post_hook warning all read it.

**Why:** the owner's Vale session put a level 4 hall job to a level 1 company at session zero; they voted it, were refused at the gate, ground 16 game hours, and voted it twice more. The five draw any template at any level in `fellowHook`.

**How to apply:** the opening names only a job the lowest member meets (else "asks for level N ... grow first: hunt <zoneFor(lo)>"); `propose {kind: job, job_id}` from an agent is refused up front with the same reason (so a refused job is not re-voted until a level changes, no state kept); `fellowHook` skips the five below MIN_LVL only when `hasLinks()`, and firstMoves filters only with a company in a hosted world, so headless hashes hold. The first delve not planning in that Vale world was the owner's choice (Straight to the hall), not a bug. See [[first_delve]].
