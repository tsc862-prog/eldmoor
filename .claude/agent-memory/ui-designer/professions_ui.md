---
name: professions-ui
description: Professions block (Stats tab) and setup page pickers (#259 first half); where the place choice lives
metadata:
  type: project
---

Block in src/ui/professions.js (professionBlock, called from tabStats in panels.js). Setup slot field `profs` (0-2 ids, absent = let them choose) is validated/cleaned in sim/setup.js, seeded in applyMinds through seedProfs (sim/professions.js) and kept in S.setup.profs so offerReplacement (fellowship.js placeProfs) gives a replacement the place's choice.

**Why:** #259 split in halves; crafted items, recipes and gathering UI wait for #257/#258.
**How to apply:** in setupcheck, a second init() in one process needs disbandFellowship() first or founding silently refuses. Edit scripts via python with absolute paths: cwd resets between bash calls.

**Second half (#259, branch ui/professions):** professionBlock now adds a `.profd` line under each trade (gather: what it takes, a stretch, next, nodes in sight via nodeNear; craft: recipes, green when canCraft in town, next, last "Made ..." from a.history), a `.profmeal` supper line from mealOn(a), "by <maker>" tags in Gear/Pack rows, and a Materials group in the Pack. Gathers are not recorded in history, so there is no last-gather line (needs a sim record). Crafted gear is never auctioned, so no AH listing. uismoke stub DOM has no nextElementSibling: query `.profd`. Browser check at 3440: chrome headless over CDP with `ws` from the worktree node_modules, vite on `localhost` (not 127.0.0.1), import sim modules from the page to set state.
