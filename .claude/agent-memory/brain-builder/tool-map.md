---
name: tool-map
description: #640 generated tool map in standing orders - toolmap.mjs, groups, budget, short variant, orderscheck assertions
metadata:
  type: project
---

`scripts/toolmap.mjs` builds a TOOL MAP block from `PLAYER_TOOLS` and `DM_TOOLS` (one line per tool: name plus the first sentence of its desc, cut at 58 chars). Hero: inside `ORDERS_FULL` (full) and `ORDERS_SHORT` (names only, local models); `ORDERS_SHORT_HAND` is what `SHORT_BUDGET` 1200 limits. DM: `withToolMap(sess.system, 'dm', local)` in `dm-agent.mjs` after the runner settings are known.

**Why:** owner asked (#640) that every tool be named in the orders so none goes unused; new tools must show up with no hand edit.

**How to apply:** a new tool needs no edit to appear (unlisted tools land under "More tools"); optionally add it to a group in `HERO_GROUPS`/`DM_GROUPS`. Budget `MAP_BUDGET_CHARS` 7000 (hero ~5.3k, DM ~2.7k); raise it if orderscheck fails on size. orderscheck asserts every tool is in its map, group names are real tools, no duplicates, and the hand-written orders name only existing tools (map text is stripped first). Heredoc pitfall again: write regex/backslash code with Edit, not shell heredocs.
