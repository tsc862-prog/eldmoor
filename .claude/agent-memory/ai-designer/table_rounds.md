---
name: table-rounds
description: Table combat rounds (#276, src/sim/tableround.js) - foe in initiative, d20 vs 10+Defense*20, 3-round cap, one DM log entry per scene, late agents not re-waited, test pitfalls
metadata:
  type: project
---

#276 (part 1 of #140): combat kinds (elite/ambush/boss/rescue) play up to `TR.ROUNDS` 3 rounds; then the fight goes on in
real time. sc.ids stays members only (UI, checks and pace.js read it); the foe's place is `sc.foeAt`, round `sc.rd`,
foe-acted flag `sc.fd`. A scene without sc.rd (old save) plays the old single pass.

**Why these rules:**
- Round cap: Kragmaw has 13000 HP and agents wait per turn; an uncapped fight would pause the world for minutes.
- Both sides roll (d20 + 3 + lvl/2 vs 10 + Defense*20; creature guard*20, boss 0) and damage goes through the
  real-time paths (strike, mobs.js `mobBlow`, the boss's own claw/breath timer) so rounds and real time share numbers.
- A foe acting during the pause offsets the free member strikes the old single pass gave; balance-tester (10x120)
  found elite win 95->100%, Fellowship deaths 0.8->0.2, levels unchanged.
- DM log: ONE `kind:'table'` entry per scene (detail.by 'scripted', sceneType 'fight'). Per-round entries flooded
  the 200-cap log (campcheck lost its camp line) and kind 'roll' would reopen check scenes and spam memories via
  fellowship.js readDm.
- A live agent that ran out liveMs once is not waited for again in later rounds (`sc.lw`): 3 x 2 min stalls otherwise.
- Staged per-act DM calls, scripted voice lines and per-act memories only in round 1 (volume).

**How to apply:** tests that check the one-pass turn flow set `TR.ROUNDS=1` and a near-zero `m.hit`; never kill a
main-party member in tablecheck (later sections need all five) - use a child process. Open follow-up noted by
balance: Fellowship adventure/check scenes per run dropped ~half after the change (cause unconfirmed).
Related: [[table-simultaneous]], [[fellowship-always-agents]].
