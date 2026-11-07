---
name: multi-world-checks
description: initiatecheck reads every dungeon (not CRYPT) and runs itself in each world; Vale crawl safety numbers and candidate rooms
metadata:
  type: project
---

initiatecheck (#826) assumed Eldmoor's first dungeon: it watched `CRYPT.group` only, but a background group answers the dungeon that fits its heroes (`cryptFor`, nearest meeting `entry`), and a proposal reserves that dungeon (`cryptReserved(D)` takes a dungeon, default CRYPT). On the Vale CRYPT is the far Drowned Weir, so all four failures were the check, not the sim. It now reads `CRYPTS` (helpers `groupOf`, `clearGroups`) and ends with `runWorlds('initiatecheck')`, so CI covers every world with no new step.

**Why:** a check that names `CRYPT` passes on one-dungeon worlds and fails on honest multi-dungeon ones.
**How to apply:** in any check, loop `CRYPTS` or ask `cryptFor`/`cryptOfCtx`; never `CRYPT.group`.

Vale crawl (2026-11-06, 120 min, 3 runs): rooms are relative to the party (`lvl` is +/- the crew's average), so entry level hardly matters; only foe bodies, `hit`, `rounds` and gear do. Fellowship at L12-14 cleared 119 of 121 with 1 death. Proposed rooms are in PR body (scratch candidate: +1 room each in Barrow, Vaults, Kiln, Weir rounds back to 2/3) measured 0.67 deaths and ~85% clear a run. Not applied: numbers go through balance.
