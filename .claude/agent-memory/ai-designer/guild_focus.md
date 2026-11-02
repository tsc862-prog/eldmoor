---
name: guild-focus
description: #6 slice 2 guild focus (guildfocus.js): Delve/Wyrmhunt/Wayfaring/Warpath, how each steers rolls, no-dice choice, GF.ON neutral hash proof, Fellowship out
metadata:
  type: project
---

Guild focus (issue #6 slice 2, after rivalries [[guild-rivals]]) lives in `src/sim/guildfocus.js`.

- Foci: crypt (Delve) weights the guild x3 in dungeonCheck's guild pick (`pickW`, one die, identical to pickA with all weights 1); raid (Wyrmhunt) sorts members after raidPull and lets a core of 3 skip the raid gear gate; adventure (Wayfaring) raises the DM's K.TAKE to .98; pvp (Warpath) x1.3 chance-duel and assist odds.
- Choice is a score per focus from guild state (members at CRYPT_LVL/RAID_LVL, oath pulls, record, temper), no RNG; weighed daily or on a leader change, hysteresis 0.75. Warpath only with a blood-oath leader or a declared rival.
- **Why:** multiply/reorder existing rolls so `GF.ON=false` gives the same seeded hash as main (verified at 1200 s: 1713180306 / 1662930905). With focus on the world changes; measure with balance-tester, not single runs.
- Early game nearly every guild is Wayfaring (low levels); Delve/Wyrmhunt appear once members reach L7/L14.
- `init()` does not clear S, so a seeded determinism test must rerun in a fresh process (focuscheck spawns children).
- Fellowship: a guild with a living member is forced 'open'; duel/assist hooks return 1 when a Fellowship hero is involved.

**How to apply:** new guild-level steering goes through these hooks (cryptWeight, raidFirst/raidCore, takeChance, duelFocus/assistFocus); if PvP share climbs, lower GF.DUEL before touching rivalry multipliers.
