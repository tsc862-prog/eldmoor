---
name: seeded-import-dice
description: #888 - GOODS opening stock is rolled at import (data/items.js) before any seedRng, so a check that seeds after static imports differs per process; import scripts/seed-first.mjs first
metadata:
  type: project
---

`src/data/items.js` rolls each GOODS `supply` with `ri(2,14)` when the module loads, and `src/sim/index.js` keeps those as `GOODS0` that `init()` restores. `seedRng(n)` runs after the imports, so a "seeded" run starts from a different auction house in every process. That alone made `pathcheck`'s seeded `run(5)` differ between machines (a rare "stands fast for 10 seconds" in CI, #888).

**Why:** found by running one seeded 30000-tick world in 12 processes: 2 of 12 diverged at random ticks; wrapping Math.random and importing the sim showed 12 draws at import, all from items.js. Wall clock was not involved (no Date.now or performance.now reaches step()).

**How to apply:** a check that must be reproducible imports `./seed-first.mjs` before anything that loads the sim (hashcheck probes stub Math.random the same way). Do not change the import-time roll in items.js: the hash probes depend on those draws under their stub. Proof of determinism: `plans N worst search M` lines of pathcheck are identical across processes.
