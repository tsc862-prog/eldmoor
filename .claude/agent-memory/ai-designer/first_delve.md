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
- Tuning: a room's `rounds` is 6 (boss 8) because reflexes spend round one on specials; with 3 and 4 they were driven back 37 of 40 runs. Blow size, not foe toughness, is what makes downings: keep rounds few by few `hits`. Level-up heals in full, so XP lands late in room two.
- Rows are used once a world, so an apart world's two pairs in one town need two rows of a faction.

Related: [[arrival-and-session-zero]] [[dm-sites]] [[companies-initiate]]
