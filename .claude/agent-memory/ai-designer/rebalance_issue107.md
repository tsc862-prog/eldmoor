---
name: rebalance-issue107
description: Post-Fellowship balance pass (#107) values and why - crypt wipe .40, Webspinner/Boar softening, xpNeed ramp, replacement seeding, duel .0375
metadata:
  type: project
---

Values set in #107: crypt wipe death chance .55 -> .40 (dungeon.js); boar tilt dps .88 aggro 1.0, spider tilt dps .84 hp .95 aggro .9, wolf tilt dps 1.1 (bestiary.js; wolf/bog raised only to keep bestiarycheck's 3% dps and 8% zone-0 bands green); xpNeed multiplied by 1+.8*clamp((l-9)/7) (the issue's +25-30% only moved the cap ~10 min); Fellowship recruit() seeds at lowest living member lvl - 2 via heroes.js seedLevel; duel chance .04 -> .0375 (pvp.js).

**Why:** removing crypt/mob deaths makes PvP the larger share of a smaller pool, so PvP share sat at 45-48% until duels were trimmed; trimming duels too far (.03) puts heroes back into hunting and mob deaths rebound, and deaths/h drop under 20 - so .0375. Fellowship ghost records come from F.last (updated each tick).

**How to apply:** measure with 10 runs, not 5 - mob15 ranged 2-27 across 5-run batches. Count deaths by polling S.agents for state dead (S.fallen caps at 15). Headless "minutes" are real minutes at 1x (3600 frames each).
