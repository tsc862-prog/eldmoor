---
name: narrator-rules
description: Design rules behind the Chronicler narrator (issue #26) - why the dice consequences are sized as they are, how the 20s cap and hook placement work, and how to measure narrator changes against baseline variance
metadata:
  type: project
---
The Chronicler (src/sim/narrator.js + src/data/narration.js, 2026-11-01) adds scene lines,
real d20 checks and a dawn recap. Rules that are not obvious from the code and why:

- **Scout pass lands a real strike, not just `a.cd=0`.** The brief said pass = `a.cd=0; m.cd=1.3`.
  A hunting hero's cd is already <=0, so that was worthless against an adjacent ambusher while the
  fail was a full free bite; mob deaths quadrupled. Pass now calls `strike(a,m)` (if within range+.5)
  and sets `a.cd=1.1` so the fight case cannot swing again the same tick; a kill there leaves the
  case's strike/flee lines inert because state is already `hunt`. Never call `strike` from a hook
  without resetting `a.cd`, or killMob runs twice.
- **Scout fail damage is floored at 1 HP.** The fight case keeps running after the hook; a death
  inside it would let a dead hero strike. Lethality belongs to the fight itself.
- **Flee fail is a glancing bite (FLEE_GLANCE .35), DC 11 as specified.** A full parting bite killed
  10-16 heroes per 2h because the flee trigger (`rnd()<dt*1.2`) fires ~0.8s after crossing 22% HP,
  so fleers are usually far below the threshold. At .5 it was still 6-16 deaths; at .35 it is 3-5.
- **Zone-entry scenes need no hook:** narratorTick flags `a.narScene` (reset in town, set in follow)
  and fires on the first `hunt` tick for solos and party leaders. Cleaner than a party.js insert.
- **Cap:** one scene line per 20 real s. Only a scout fail that leaves the hero under 50% HP, any
  flee fail, a fatal flee roll and the dawn recap jump it. Rates that landed at ~120 lines/h:
  SCENE_P .4, SHOW_SCOUT .15 (a dozen scout rolls happen every minute), SHOW_FLEE .4.
- **Ambush detection:** at the hero's first fight tick `m.target===a` means the mob struck first
  (mobs.js sets both sides); the hero's own engage sets `m.target` only once in range. Party
  members joining the leader's fight get their own roll against mobs 2+ levels above them.
- **Measurement:** baseline on main is 92-124 deaths per 120 min (4 runs), not the +-15 I used to
  assume; two runs cannot resolve a 10% change. Use `git archive origin/main src | tar -x` into the
  scratchpad and run the same measurement script against both roots (ROOT env var). Mob deaths
  swing 9-28 at baseline on their own (22 of 28 at level 1 in one run).

Open follow-up: the narrator could record scout/flee rolls on the dossier via `record()` (it does)
but the headless harness does not print `S.narStats`; add it to scripts/headless.mjs when touching
that file.
