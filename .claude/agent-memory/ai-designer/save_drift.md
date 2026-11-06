---
name: save-drift
description: savecheck v7/v6 flake was a fixture fault (solo id reuse); hunting it found real save losses - boss saved as a self-reference, module dice and timers, narrator identity; kept.js and the play-on check
metadata:
  type: project
---

Restored worlds now play on exactly like the original, and `savecheck` proves it (`--playon` child: same dice from the save, full snapshot diff after 2 minutes).

**Why:** the `and 10 s later: v7 / v6` flake was never load or wall clock. It failed in exactly the worlds where the first solo died (`solos: Hestow` in all 6 CI logs read; `Haelwy` passes): the v6 migration numbers the new solo 2, the dead solo's id, so it inherited `S.dmFocus.last[2]` and the board refill drew other dice. Import dice picked the world, so #893 only pinned seed 324 to a passing world. Comparing the original against a restored copy found what was truly lost:
- `S.boss` was saved as `{ref:'boss'}` (ser's refs map hit it at top level) and restore then emptied it: since the first save version, a reload left Kragmaw `{}`, respawn NaN, gone for good.
- `n.lastFallen` compared by identity, so a reload put the whole fallen list in the dawn recap again.
- The six private flavour LCGs and the once-a-second `acc` timers lived in modules; the company watch (`fightSeen`, `lastState`) too.

**How to apply:** new module state that the world's future depends on registers with `keep(name, get, set)` in `src/sim/kept.js` (saved as `snap.kept`, values must be plain data, setter runs after S is refilled). A visible first difference may be late: the dice stream is not in a snapshot, so compare per-tick draw counts and stacks by wrapping Math.random after `seedRng(null)`. Left unsaved on purpose: `_gb` (gambit record) and `_al` (action log), non-enumerable runtime records; `lastRoll`/`pendLevers` in dm.js only fold DM log text. Identity comparisons on plain objects in S do not survive a reload: compare by a key. See [[check-fixtures]], [[seeded-import-dice]].
