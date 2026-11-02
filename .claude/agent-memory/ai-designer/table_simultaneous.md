---
name: table-simultaneous
description: Table scenes where everyone answers at once (PLAY table in table.js) - which kinds, why slot-order resolution, presence, staged combined DM call, check impacts
metadata:
  type: project
---

Owner request (2026-11-01): independent Table answers are asked of all members at once. `PLAY` in src/sim/table.js
is the one table of kinds: `turns` for elite/ambush/boss/rescue/site/room, `all` for decision/check/choice and the
staged meeting/social/trap/mystery. Unlisted kinds default to turns (old saves without `sc.all` stay in turns).

**Why these rules:**
- Resolution is in Fellowship slot order with reflexes chosen at resolution time, never at arrival: trap/mystery
  rolls use the gameplay RNG and `aid` heals the lowest, so arrival order would otherwise change outcomes.
  tablecheck's `--simul fwd|rev` child proves it.
- Waits are per member (`sc.w[id]` {t,nudge,late}), run side by side, so N silent agents cost one liveMs, not N.
- Site/room stay in turns although they look independent: owner listed Crypt chambers as sequential.
- Staged `all` scenes skip per-act DM outcome calls; `onAll` in staged.js pushes one combined outcome (beat:'all')
  plus the complication after everyone answered (owner: "the DM narrates the combined result").
- Presence: decision = voters(P); others = members within shout range of ctx.anchor (or ctx.hero, else the leader).
  Sequential kinds still take all fellows (unchanged).
- decisionsWaiting skips waitingVoters for the prop at the table; scene_act on a decision only casts the vote at
  resolution, so the open vote would otherwise list members who already answered.

**How to apply:** a new scene kind needs a PLAY row; tests that open a 'check' scene now see every member on turn
(localcheck F was rewritten for that). Related: [[talk-range]], [[camp-rest]], [[fellowship-always-agents]].
