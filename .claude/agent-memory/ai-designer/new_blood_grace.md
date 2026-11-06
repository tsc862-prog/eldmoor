---
name: new-blood-grace
description: #660 replacement spiral fix - Fellowship replacements are no chance-duel target for 480 game minutes (NEW_BLOOD)
metadata:
  type: project
---

`recruit()` in company.js stamps `a.newBlood = S.gameMin + NEW_BLOOD` (480) on a Fellowship replacement; the chance-duel roll in `pvp.js` skips a pair when either side is still new. Nemesis hunts and grudges are untouched (a newcomer has none), mobs and the Crypt are untouched, death stays permanent.

**Why:** about 2 runs in 48 lost 8-10 Fellowship members: each replacement joins `SEED_BEHIND` 2 under the lowest mate, inside the duel level gap of the same hunters who killed the others. Only recruit() (Fellowship, no-host path and seatRecruit) is stamped; arrival.js makeRecruit of other companies is not.

**How to apply:** measure with the unseeded `sim 120` x24 per side (spiral = Fellowship deaths >= 6); numbers in the PR. Seeded hashes move only where a Fellowship replacement happens in the run.
