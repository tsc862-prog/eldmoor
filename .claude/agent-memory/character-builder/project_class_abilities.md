---
name: class-abilities
description: Issue #81 class abilities - data/moves.js MOVES/PASSIVES, one resolver in sim/moves.js for real-time and Table rounds, eff.js timed effects, balance effects and gotchas
metadata:
  type: project
---

Issue #81 (2026-11-01, branch `characters/class-abilities`): 3 actives + 2 passives per class, original names (see docs/LORE.md "Class abilities").

**Layout:** `src/data/moves.js` (named "moves" so it never clashes with `data/abilities.js`, the six scores) holds MOVES (name, cls, kind, lvl, cd seconds AND rounds, cost, target, range, swing, fx, dur/durR, save, `use` policy tag, desc) and PASSIVES. `sim/moves.js` is the one resolver (`useMove(a,id,t,{mode:'sec'|'round'})`), `canUse`, scripted `pickMove`/`fightMoves`, `abilityView`. `sim/eff.js` holds timed effects (`e.eff[key]={v,u,r}`) and passive sums; `stats.js` reads passives as breakdown entries (health/defense/crit) and `dmgTaken` multiplies the `taken` effect and low-HP passives.
**Why:** one effect path for field combat and the future Table combat round-by-round; cooldown expiry is stored as an absolute sim-second (`S.gameMin/6`), so it needs no per-step ticking and stops with the paused world; round cooldowns are `a.mcr` ticked by `tickRound`.
**How to apply:** new ability = a row in MOVES plus, if it needs a new effect, a branch in `onFoe`/`useMove`; new policy rule = a `use` tag case in `wants()`.

**Balance:** abilities make heroes stronger (mob deaths halved at first). Defensive cooldowns were lengthened (Bastion 40, Ward of Dawn 20, Smoke Veil 36, Chorus 34, Challenge 18). Attack abilities do NOT fire in duels between heroes (they spiked PvP deaths through the 30% yield threshold). Agent-played heroes (`a.player`) never get scripted ability use; they call `use_ability`.
**Gotchas:** the spatial grid is rebuilt once per `step`, so tests that move mobs by hand must call `rebuild()` before area abilities; `playcheck` has a 12-action/game-hour rate budget, so a new tool call in the middle of it needs `a.playRate=[]` afterwards.
