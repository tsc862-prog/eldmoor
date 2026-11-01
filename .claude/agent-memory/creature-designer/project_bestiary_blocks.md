---
name: bestiary-blocks
description: How the bestiary (issue #84) is built: role calibration, ability policy, why effects only touch hero.cd/position/hp, elite and named-foe handling, encounter builder, and measurement gotchas (2026-11-01)
metadata:
  type: project
---

Built 2026-11-01 on branch `creatures/bestiary` (PR for issue #84). Files: `src/data/bestiary.js` (ROLES, ABILITIES, BESTIARY, VARIANTS, ELITE_TEMPLATE, NAMED_KITS, `blockOf(type,variant,role)`), `src/data/bosses.js`, `src/data/encounter-tables.js`, `src/sim/encounterbuilder.js`, `src/sim/loot.js`, `scripts/bestiarycheck.mjs` (+ `-builder.mjs`).

**Calibration, not feel.** COUNTS-weighted mean hp/dps/xp multipliers are ~0.98/1.02/1.00 overall and within 8% per zone; `npm run bestiarycheck` asserts it. When adding a species, pick its role, then add `tilt:{hp,dps}` until the zone mean is back near 1.0. Ability damage is carved out of the plain bite (`abilityShare`) so total dps equals the role's number. Crit (x1.6) is also divided out of the bite.

**Why abilities only touch `hero.cd`, position and hp.** heroes.js belongs to other agents (abilities/skills, agent player). Slow, root and fear push back the hero's attack timer (`t.cd += lose`); knockback moves the hero and costs a strike; poison is a dot list on the MOB (`m.dots`, hero refs) so nothing is stored on the hero. Guard and resistances are applied in updMob by shrinking the hp the mob lost since last frame (`m.hpl`), keyed on the target's class tag, so they never apply to the killing blow.
**How to apply:** any new effect should follow this rule; if a real hero hook is needed, ask ai-designer.

**Elites**: ELITES rows keep `scale`/`hit` (fauna.js clones them); the check asserts they equal ELITE_TEMPLATE. Each elite gets one extra ability from ELITE_EXTRA. Template xp/gold are NOT multiplied (would change levelling).
**Named adventure foes**: species as role `leader`, hp = formula x BEAST.scale (unchanged), bite from leader block x BEAST.hit, ability kit from NAMED_KITS.
**Site foes (VARIANTS)** have no MOBS row on purpose: MOBS rows without COUNTS would be picked as quest targets (heroes.js newQuest) and never spawn. They borrow a field species' sprite via `base` and spawn as that type with `m.v`. Known cosmetic gap: `agentDie` and DM text name the base species ("fell to a Bogling") for a Reedcutter.

**DM fights** use `buildEncounter(..., {mono:true, variants:false})` so narration ("three Boglings") stays true; the count is the scene range clamped by budget (party size x 0.95, creature cost = role cost x 1.22^(level gap)). Road ambushes in encounters.js are dice, left alone.

**Kragmaw** is the template `kragmaw` read by boss.js; numbers identical to the rebalance baseline (one phase, no adds, no enrage). Vesk's template is data only (crawl rework #65 will use it). Boss adds are declared but not yet spawned by the raid engine.

**Measuring**: S.fallen is capped at 15 entries, so use `facStats[].fallen`/`honor` for totals. Sims use Math.random, so compare 3+ runs of 120 min against an `origin/main` copy (git archive into the scratchpad). Worktree-isolated shells refuse some compound commands; write patch scripts with the Write tool and run them with literal paths.
