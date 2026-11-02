---
name: quest-log
description: Quest log (#quest tab, branch ai/quest-log): how several quests per hero are held without touching the scripted sim, and why
metadata:
  type: project
---

The quest log (src/sim/questlog.js) derives each hero's quests from where they already live (a.quest, a.adv / S.adventures hooks, a.goal, a.nemesis, S.staged + S.table) instead of moving them into a new store. Only `a.qlog = {focus, done[], scene?}` is new, made lazily.

**Why:** the owner wanted a Quest tab with board, DM and oath quests, but scripted balance had to stay exactly as it was. Deriving keeps every scripted code path untouched; a seeded 30-min world hashed identical to main with and without a Fellowship.

Rules added:
- Holding several is agent-only: a taken job is a hook with phase 'taken' + h.taker (not 'held': take_adventure already uses phase 'held' transiently); a set-aside adventure is `adv.held = heroId` and dmTick skips it except death and expiry; finish() skips goHome for a held adventure.
- A running adventure is always the focus (the DM drives a.adv); a.qlog.focus only matters when nothing runs.
- DM tagging: postHook stores h.by (non-scripted callers via the post_hook lever's ctx) and h.ff for the scripted DM's Fellowship-first hooks (fellowHook). The hero's tool view hides `from` (channels rule).
- Auto-resume near place only when the hero is solo/leading, nothing queued, not on another adventure.
- Done lists are packed (no null fields) and capped 20 for agent/Fellowship heroes, 6 for scripted: about +8% save size.

**How to apply:** new quest sources should add a builder in questlog.js and a done hook, never a second copy of the state; verify with `npm run questcheck` (its first section proves the scripted world unchanged in subprocesses). See [[dm-adventures]], [[fellowship-always-agents]].
