---
name: wounds-tending
description: #656 wounds rules - why wounds.js is a leaf, who tends, once a day, priest is the existing NPC, scripted rest and Crypt rules, what the balance showed
metadata:
  type: project
---

Wounds live in `src/sim/tend.js`, numbers in the leaf `src/sim/wounds.js` (2026-11-04, #656). Rules added and why:

- **Leaf module:** stats.js and moveTo read the penalty, so wounds.js imports nothing; tend.js may import stats, lore, reflect. maxHp stays one reader: combatStats applies the wound last, and the stats cache key carries the wound count.
- **Speed = both** the swing timer and the walk ("speed" in the issue is ambiguous; a limp and a slower arm). Cap .3 applies to each: HP stops at two wounds, speed at three.
- **Who tends:** the issue's wording, not the epic's healer-only one: a heal from a healer anywhere, or anyone at a company camp. Nobody tends their own, so a solo needs the chapel. One tending a game day per patient, the priest separately once a game day.
- **A heal lifting the downed is not a tending** (tendBlock on state downed): the rescue must not also shorten the cost.
- **Priest = the existing NPC at the chapel spot:** no spec edit, because #791 slice 2 and PR #810 are moving town plans. Wakes-a-stable-hero from the epic is not built.
- **Scripted rules use reflexMay or !a.player, no dice:** Crypt pool skips wounded !a.player, reflex vote says no, mend state only for !a.player and no company (a company rides as one).
- **Fear** is e.fear, cleared by slain(): a permanent fear would stop an agent ever hunting that creature.

**Why:** owner answer 4 on #626. **How to apply:** balance at #656, 20 runs a side: nothing outside noise. Most background downings end in death (about 3.9 of 13.9 a run get up), so wounds barely touch the background; the real effect is on companies. Tune `WOUND` only with that in mind. Bash heredocs with apostrophes fail to parse in this harness: write Python edit scripts with Write. See [[downed-saves]], [[table-rescue-saves]], [[learn-the-world]].
