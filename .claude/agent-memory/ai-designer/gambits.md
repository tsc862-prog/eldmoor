---
name: gambits
description: #617 gambits - per-hero ordered rules run by autopilot and fight reflexes; presets = old policy rule for rule, hash identity, phases, MAX 24
metadata:
  type: project
---

Gambits (#617, owner request 2026-11-03): `a.gambits` (only once the agent edits; else `presetFor(a.cls)`, frozen and shared) run by
autopilot (`idlePick`, first rule that holds AND whose action can run; an action returning null falls through), the fight tick
(`fightRules`, EVERY fight rule that holds acts in order; flee/retreat/hold end the moment) and the full-pack reflex (`reflexPick`,
sell_loot rules only). Engine + world-only conditions in `src/sim/gambits.js`; conditions needing PK knobs and all actions are
registered from `src/sim/player.js` via `defineGambits` (no import cycle). Vocabulary and presets in `src/data/gambits.js`.

**Why the preset looks long (15 idle + 3-4 fight rules, MAX 24 not the issue's 12):** it is the old autopilot()/townPilot()/fight()
written out in exactly the order the hard-coded code checked, with context-sensitive actions (rest/sell_loot/hunt_region/
follow_leader do the town or field branch; town-only or field-only actions return null elsewhere) and an optional second
condition (`and`) where a branch was town-only (`in_town and self_hp_below 90 -> rest`). Fight presets keep "own judgement"
semantics: `always -> heal` = priestHeal, `always -> drink_potion` = fightAid; any other condition makes them act directly.
`past_flee_mark` reproduces the PK.FLEE / cmd.flee / wary .22/.5 compound flee mark.

**How to apply:** any change to the autopilot or fight reflex must keep `hashcheck`'s `autopilot (agent heroes, #617)` row equal
(child in scripts/hashcheck.mjs: 12 heroes marked agent and left idle 300 game min, with and without Fellowship). Conditions
must stay pure (no RNG, no writes) or that row moves. The runtime record (`a._gb`: last fired, log, once-timers) is
non-enumerable so it is neither saved nor hashed. A new reflex belongs in the vocabulary plus the preset, never inline.
See also [[autopilot_caution]], [[town_autopilot]].
