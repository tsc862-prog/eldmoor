---
name: dungeon-crawl
description: Issue #65 dungeon crawl: Fellowship plays the Sunken Crypt room by room as Table scenes from spec rooms; design, tuning numbers, gotchas
metadata:
  type: project
---

The Fellowship's Crypt run (#65) is `src/sim/crawl.js`: rooms are data on the spec landmark (`CRYPT_ROOMS` in `src/world/spec.js`, copied to `CRYPT.rooms` by `gen.js`), each round of a room is a Table scene of kind `crawl` (turns), dice at the table, real HP, `fall()` on zero. Background groups and Watch mode keep the abstract `pw` roll (`dungeon.js`, hooked by `setCrawlHook`; crawl.js is imported from `sim/index.js` to dodge an ES-module cycle with table.js).

**Why:** the owner wants the Fellowship's dungeon as a played story, deaths from table dice rather than a hidden wipe roll, with the background balance untouched.

**How to apply:**
- Site foes (shambler, graveward, boneshot, tombskit) live in `VARIANTS` in `data/bestiary.js`, not `BESTIARY`; use `species(type)` from crawl.js.
- Tuning (reflex play, level 10, gear .8x level, 30-40 runs): room `hit` .10/.13/.13/.17/.19, Vesk hits 8 atk 1.6, `DC` 9, `BREATH` .12 gave about 80% clears, 17% driven back, ~0 deaths. Small hit changes swing it hard (+25% hit: 30% clear, 0.6 deaths a run). Outcomes are level-invariant (foes scale with the party).
- A member's act is injected by tests during the `frame` phase; with no runner a reflex acts in the same tableHold call as the frame ends, so `turn` phase is never visible.
- `init()` keeps `S.fellowship.crawl` across calls in one process: tests use deltas.
- Scene count: ~12-20 rounds a crypt, each needing five agent turns; flag the cost if agents feel slow.
