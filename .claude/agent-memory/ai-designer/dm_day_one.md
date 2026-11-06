---
name: dm-day-one
description: #910 - DM board state must exist before the scripted DM's first tick; postHook/withdrawHook call ensure(); dmcheck --dayone child
metadata:
  type: project
---

`S.adventures` and friends are made by `ensure()` in `dm.js`, which only ran from `dmTick`, `dmDepart`, `beginJob`. The agent's prep turn runs while the world is held (no tick yet), so `post_hook` -> `postHook` pushed to undefined. Now `postHook` and `withdrawHook` call `ensure()` (same initial values the first tick sets, so seeded hashes hold).

**Why:** the opening job never reached the board on day 1 of a new world.
**How to apply:** any new exported dm.js function that touches S.adventures/dmStats must call `ensure()` first; other readers elsewhere already guard with `S.adventures&&`. `node scripts/dmcheck.mjs --dayone` runs a held, untick'd world through the DM tools and fails on a crash.
