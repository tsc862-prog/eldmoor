---
name: table-conditions
description: Table parley and conditions (#296) - stun/root/poison in e.eff held in rounds only, saves as beat.check not beat.roll, cleared at scene end, parley talkers and results, test pitfalls
metadata:
  type: project
---

#296 (last part of #140): parley and four conditions in Table combat rounds (src/sim/tableround.js, wired in table.js).

- Conditions live on `e.eff` as `{v,u:0,r,dc,by}` under keys stun/root/poison (eff.js `setCond/condOn/condsOf/endCond`);
  `eachRound` SKIPS those keys: tableround runs them down itself (stun spent on its holder's turn; root and poison saved
  against at round end in `roundEnd`, called from table.js `nextRound`). Warded = the round-counted 'taken' ward (v<1, r>0).
- Laid by: a member's MOVE_CONDS move only in round mode and only when the move's own save failed (no extra roll), and a
  creature's bestiary ability via FX_CONDS when its blow lands (once per COND.TRICK_GAP rounds, target saves).
- `clearRounds` at the outcome deletes conditions AND round-counted taken/mark: before #296 a ward set in a late round
  leaked into real time until the next scene.
- Saves and parleys put their data on `beat.check`, never `beat.roll` (roll = attack vs AC; #285 tests assert every
  beat.roll matches the "d20 x+y=z vs AC" text). DM log entries use `die`/`mod`/`dc`, not `d20`, for the same reason.
- Parley: once per member per fight (`sc.pl`), only vs enemy heroes and bandit/brute-folk mobs, never Kragmaw. Yield (nat 20,
  5+ over, or any pass on a rooted foe) sets `m.spared` = 2 game hours (mobs.js scan and findMob skip it); flee = fled 5 s;
  hold = it targets the speaker. Reflex parleys only when hurt and rooted, or a trained talker vs a foe under 35%.

**Why:** no-Fellowship and Table-Off hashes must not move: every new roll is inside Table rounds; `spared` is unset elsewhere.
**How to apply:** tablecheck's 2b fixture sets `q.ab=[]` so tricks never perturb the #276/#285 assertions; the #296 cases run
in the `--parley` child and pin dice by rewinding the check's LCG (`forceNext`), because rng.js captures Math.random at load.
Related: [[table-rounds]], [[table-step]].
