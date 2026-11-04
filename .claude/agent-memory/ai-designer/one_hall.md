---
name: one-hall
description: #771 a together company of mixed peoples founds in one hall - why gather is setup-only, why tests run in stepping, session zero hold and cap, a.born, arrivals by the leader
metadata:
  type: project
---

#771 (2026-11-03): a together company of mixed peoples started in two towns, session zero seated 2 of 5.

Rules chosen and why:
- **`foundSlots(...,{gather:true})` only from a setup.** `init()` without a setup must not change, and a founding in a running world must never teleport anyone. So `play-headless --session-zero` on a default Stepping world can still start scattered: the session zero hold covers that case.
- **Members already all inside the hall town stay exactly where they are** (no dice, no spread). That is what keeps a single-people setup byte-identical.
- **Eldmoor has one town a faction**, so every Eldmoor hash is blind to this: mixed-people tests must run with `ELDMOOR_WORLD=stepping` in a child. A stepping setup with "any people" does change (that is the bug), a stepping setup of one people does not.
- **`a.town` stays the hall (home, `homeOf`)**; `a.born` keeps the people's town for origin text only (`factsOf`, `buildBackstory`, `introLine`). Set only on the gather, arrival and apart paths, never in plain `joinSlot`, or a seeded replacement's backstory could move.
- **Session zero hold**: `gathered(q)` in sessionTick, `q.hold` saved, anchor is the leader; `ARRIVE.GATHER_MIN` 540 game minutes then it opens with those present. No hold with the Table off. The world runs during it (they must walk), so a member in range can wander off until the cap.
- **pace.js reads `q.hold` itself** instead of importing arrival.js: a new import edge risks a load-order break in the cycles.
- **Arrivals**: the WAIT_DAYS fallback used to put the newcomer at the home gate while the company was in the field (`where:'road'` now puts them by the leader). A non-slot company's recruit kept its own `a.town`.

Related: [[setup-v2]], [[arrival-session-zero]], [[talk-range]].
