---
name: origins-goals-roster
description: Backstories and oaths (issue #27): the origin/hamlet/trade tables, the 12 goal types and their tiers, the hook points in other agents' files, and how balance and completion rates were gated
metadata:
  type: project
---

Issue #27 (branch `characters/backstories`) gave every hero `a.origin` (sentence), `a.originShort` (noun phrase for the recruit line), `a.home` (hamlet) and `a.goal={type,text,tier,target?,targetId?,targetFac?,victim?,need,progress,done}`. Templates in `src/data/origins.js` (HAMLETS/TRADES/RAIDERS per faction, ORIGINS 7 per faction with `loss` bias, GOAL_TEXT/GOAL_DONE per type, `PILGRIM_ZONE='Hoarfell'`); assignment, progress and the three steering hooks in `src/sim/goals.js`.

Goal types: avenge (elite), avengeHero (guildmate's living killer, added to `a.nemesis` so pvp.js charges them), heirloom / heirloomCrypt / heirloomBoss (named epic), pilgrimFar / pilgrimCrypt (steer solo travel/hunt `a.dest` once lvl >= band-3; a.zone untouched so low heroes do not stop to hunt in the high zone), ascend, rival (living enemy 1-6 levels up), legend, hoard, delve. Tiers 0-2; a kept oath rolls the next tier; a dead target voids and re-rolls at the same tier.

**Why:** Issue wanted names from the living world and at least three types that visibly change behaviour; the hooks were kept to single inserted lines (`assignBackstory` in makeHero, `goalEvent` in gainXp/getEpic/killMob/fall/agentDie/dungeon clear/boss kill, `goalsTick` in index.js, `cryptPull`/`raidPull` sort keys) so parallel branches (gear slots, road encounters, dossier UI) merge cleanly.

**How to apply:** New goal types go in `M` makers + `TIERS` in goals.js and GOAL_TEXT/GOAL_DONE in origins.js; new hamlets/trades/origins are data plus a LORE.md line. Gotchas learned: `nemesis` keys are strings, compare ids with `==`; `legend` only completes when Kragmaw dies (0-5 kills per 2h), so it is offered from tier 1 at lvl 8+; heirloom completions are rare (0.6% epic drop) so 1-2 per 2h is normal; avengeHero needed the two lowest-level killers as targets plus shared credit for oath-bearers within 8 tiles of the kill before it ever completed (still 0-1 per 2h, which is the intended drama). Death totals in 120-min runs were unchanged (99/95/106/109 vs 103/97 baseline). PR #44.
