---
name: gathering
description: Professions gathering #257 - gather.js rules, why scripted gatherers stay in 'hunt', rate, agent-only decisions, material selling, fixture fallout
metadata:
  type: project
---

Gathering (#257, epic #238) lives in `src/sim/gather.js`; craft/give is #258 (craft.js, must not touch gather.js).

- Scripted gatherers stay in state `hunt` with `a.gathering={node,exp,until}` instead of a new `gather` state.
  **Why:** mob aggro (mobs.js), duels (pvp.js) and party pulls only see `hunt`/`travel` heroes; a new state would make gatherers untouchable. This is an exception to the "add a new state" rule. Keep it so.
  **How to apply:** do the same for any short field activity, such as camp crafting in the field.
- Agents never learn a trade or gather by script, autopilot or reflex included (`gatherTick` returns at once for `a.player`).
  **Why:** the Fellowship always-agents rule.
  The agent path is a pq command `{kind:'gather'}` run by `gatherCmd` from `field()` in player.js. The tool sets the state to `hunt`, because travel/return would route the command into travel().
- Rate: `GAP` 300, `SPOT` 10, learn at L3 by a class+trait LEAN table. That gives about 0.7 tries a hero a game day, about 340 a 120-minute run, and 61% success.
  The balance-tester ran 8 seeds and found it within noise (2026-11-02). Mob deaths edged up (4.6 to 6.4 a run, L1-5 2.3 to 3.6) and crypt deaths went down. Rerun with 16 seeds if L1-5 deaths climb.
- Materials are 'good' stacks with MATERIALS ids. `sellLoot`/`sellEntry` use `GOODS[id]||MATERIALS[id]`. `market.js` decays MATERIALS supply to a floor of 6, `save.js` keeps it as `MATS`, and `init()` resets it (`resetMats`).
- Scripted gathering moves the seeded world. channelcheck's table fixture broke because a companion was out of shout range. Fixed by parking `rest[0]` beside A ([[check_fixtures]]).
  The tablecheck STAGED failure ("6 DM calls") also fails on main 4ee5a73, so it is not from gathering.
