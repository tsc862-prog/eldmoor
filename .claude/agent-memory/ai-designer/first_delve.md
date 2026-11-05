---
name: first-delve
description: Issue #922 first delve rules - flow, default, seams, tuning, and what a future change must keep
metadata:
  type: project
---

A setup world opens intros at a small dungeon's mouth, then its crawl, then a homecoming scene at the hall gate. On by default for setup worlds (owner, 2026-11-05), still optional on the setup page. It is the one exception to #826.

**Why:** the owner wanted a story opening; the first game hours were talk in town. Default was first held at `none`, then the owner turned it on mid-task.

**How to apply:**
- Default lives in one line, `PROLOGUE_DEFAULT` in `src/data/prologues.js`. A setup stores the field only when it differs, so a default setup world has no new state and hostless hashes hold. Hosted checks that want the old hall opening pass `prologue: 'none'` (tablecheck's mixed world does).
- Nothing raises before a host reports links, because the page has no links at init: `readyPrologues` runs as the DM's prep begins (`setPrepStart`) and again in `sessionTick`.
- Needs `tableOn` and `companyAtTable`, or the crawl would fall to the abstract roll, which kills at .4. A company that fails either keeps today's opening.
- Kept off crawl.js and table.js on purpose for open PRs #902, #805, #900, #879: `kindHooks('crawl').dm`, `PLAY.homecoming`, `voicedScene`. The only crawl.js edit is the `xp` factor on the room XP line.
- Tuning: a room's `rounds` is 6 (boss 8) because reflexes spend round one on specials; with 3 and 4 they were driven back 37 of 40 runs. Nearly all deaths come from the boss room (wipes, and the downed left on the stair by DOWN.CRAWL_LEFT after a retreat from it), so the boss is kept light (hit .44, atk 1.3) and the first two rooms carry the downings (.42, .56). In --stats, `rooms` counts rooms WON: rooms=2 is the third room. Measured 400 runs each: sound 0 death-runs, .33 downs; weak 3.25% death-runs, .53 downs. Downings run below the "common" the issue wanted, by choice while it is on by default.
- Rows are used once a world, so an apart world's two pairs in one town need two rows of a faction.

Related: [[arrival-and-session-zero]] [[dm-sites]] [[companies-initiate]]
