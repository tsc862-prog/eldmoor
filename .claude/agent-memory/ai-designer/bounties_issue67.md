---
name: bounties-issue67
description: #67 kill-N quests demoted to gate-captain bounties - why adventures go first, why bounties are not levers, PAY_XP .35 compensation, old-save shape
metadata:
  type: project
---
Kill-N quests are no longer handed to every hero (makeHero/seedLevel/turnIn don't assign one). The gate captain keeps one standing bounty per region the town's living heroes hunt (`S.bounties`, dm.js `postBounties` on each board refill, lazily for old saves). At the gate step: `dmDepart` (adventure) first; only with none does `chooseBounty` take the region's bounty at `BOUNTY.TAKE` .55 x greed, dropping a held bounty for another region. Agents take/hand in with `turn_in` (optional `region`); `list_jobs` lists `bounties`.

**Why:** the owner wants adventures, the crypt and camp life to be the main progression; a bounty is a choice. Bounties are not posted through `post_hook` so they never eat the DM's daily lever limits or the Fellowship reserve, and stay out of the DM log.

**How to apply:** kill quests gave ~15% of all XP before; K.PAY_XP went .3 -> .35 to compensate. Balance-tester (10x120 a side, 2026-11-02): median L60 12.3 vs 12.2, L120 13.8 vs 14.7 (within noise, wider spread), deaths/h unchanged, Fellowship deaths 1.1 vs 0.9. If later batches show L120 > 1 level under, try PAY_XP .38 before touching BOUNTY.TAKE. ~25% of taken bounties are never turned in (death/region change). Old saves: `a.quest` without `bounty`/`at` still finishes and pays (questcheck covers it). Related: [[quest-log]], [[dm-adventures]].
