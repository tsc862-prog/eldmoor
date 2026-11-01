---
name: stat-model
description: Issue #88 stat cleanup - six scores are the only attributes, five combat totals from sim/stats.js combatStats, item armor/damage/bonus/property, calibration method and gotchas
metadata:
  type: project
---

Issue #88 (2026-11-01, branch `characters/stat-cleanup`) replaced the gear stats Vigor/Might/Guard/Precision/Haste.
The owner found the old Stats tab confusing ("different stats all over the place": class Armour next to gear Guard, three crit sources, no attack breakdown).

**Model:** the six ability scores are the only attributes; items carry `armor` (head/chest/hands/feet, Warrior shield), `damage` (main hand, Hunter longbow split .5/.5), `bonus` (score points) and one rare `property` (swift/keen/warding/vital). `combatStats(a)` in `src/sim/stats.js` (character-builder owns it) returns health/attack/defense/crit/speed plus a breakdown list per stat; maxHp/atkOf/strike crit/swing timer/dmgTaken all read it, cached per hero by signature. `CLS.arm` (.8 multiplier) became `CLS.def` (.2 fraction). `score(a,k)` in abilities.js now includes gear bonuses, so skills and DM checks see them too.
**Why:** one true figure per stat, each explainable by a breakdown.
**How to apply:** any new stat source (talents, races, buffs) should be a new breakdown entry in `build()` in stats.js, never a parallel multiplier in heroes.js/mobs.js. Level terms `lvlHp`/`lvlAtk` absorb what old gear gave the average hero; recalibrate them, not item rates, if heroes drift.

**Calibrated constants (final):** `lvlHp=13.3l+max(.5l,4.6l-8)`, `lvlAtk=2.1l-1.6-.01l^2`, ARMOR_RATE .0017, DAMAGE_PER_ILVL .68, ARMOR_CLASS plate 1 / leather .25-.3 / cloth .2-.25, crit seasoning `.0006*(l-11)^2` past L11 (needed: old Precision piled up at L20, crit fell 27% without it). All bands landed within ~5% of main; 6x120 deaths matched.

**Calibration method:** a measurement script samples living heroes every 3 min over 4x120-min runs and averages health/attack/damage taken/crit by band (1-5, 6-10, 11-15, 16+); compare against a `git archive origin/main` export in the scratchpad (src has no bare imports, so it runs without node_modules). 120-min death counts vary a lot (56-105 on the same build), so use 6 runs per side, not 3.

**Gotcha:** the session scratchpad is shared with other agents' files; keep scripts in a private subfolder.
