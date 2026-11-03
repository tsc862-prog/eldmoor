---
name: init-reset
description: init() resets the world fully (#507) - resetS in state.js, resetWorld in index.js, initcheck; what to add when a new module-level store appears
metadata:
  type: project
---

`init()` now calls `resetWorld()` first: `resetS()` (state.js, rebuilds S from a `fresh()` factory in place: arrays emptied and refilled, extra keys deleted, boss reassigned), GOODS supply/prev back to load-time values, `CRYPT.group=null` and `CRYPT.cd` back, `reserveNames([],[])`.

**Why:** a second init() appended heroes and left companies with stale ids (#507). Checks can now re-init mid-script.

**How to apply:** a new key on S needs only an entry in `fresh()`. A new module-level store outside S (Map, counter, mutated data table) must be reset in `resetWorld` or it breaks `scripts/initcheck.mjs` (hash after init twice == one init). Pitfall: core/rng.js captures Math.random at load, so a test stub must be installed once and only its state reset. Single-init seeded hashes are unchanged (professioncheck --hash, fellowship on and off, 600 s).
