---
name: professions-ui
description: Professions block (Stats tab) and setup page pickers (#259 first half); where the place choice lives
metadata:
  type: project
---

Block in src/ui/professions.js (professionBlock, called from tabStats in panels.js). Setup slot field `profs` (0-2 ids, absent = let them choose) is validated/cleaned in sim/setup.js, seeded in applyMinds through seedProfs (sim/professions.js) and kept in S.setup.profs so offerReplacement (fellowship.js placeProfs) gives a replacement the place's choice.

**Why:** #259 split in halves; crafted items, recipes and gathering UI wait for #257/#258.
**How to apply:** in setupcheck, a second init() in one process needs disbandFellowship() first or founding silently refuses. Edit scripts via python with absolute paths: cwd resets between bash calls.
