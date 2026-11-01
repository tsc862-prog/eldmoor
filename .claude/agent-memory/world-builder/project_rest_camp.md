---
name: rest-and-camp
description: Fellowship night camps (issue #64, PR 110): sim/camp.js design, state 'camp', tuning, gotchas
metadata:
  type: project
---

Fellowship-only camp in `src/sim/camp.js` (state on `S.fellowship.camp`, hero state `'camp'` skipped by the agent loop in index.js). Night 21-03 or worn (avg HP<60%/any<30%); watches 2h; ambush roll hourly 8%+2%/region; ambush opens Table 'ambush' via `openScene` export in table.js; enemy-hero visitors become a duel so the existing tableTick ambush trigger fires.

**Why:** mobs only aggro heroes in hunt/travel, so a 'camp' state is safe by construction; stray 'camp' states are freed each tick.
**How to apply:** no mana exists (HP only). Zone 0 (Thornvale) is a valid camp zone. `npm run sim -- 120` crashed on main from memorials.js reading S.legends as an array (fixed in PR 110). tablecheck determinism check can flake under load.
