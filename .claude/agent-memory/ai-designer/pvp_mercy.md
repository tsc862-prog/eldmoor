---
name: pvp-mercy
description: #657 mercy.js rules - PvP downs not kills, victor finishes or spares, life-debts, bled = no credit, finish = guild grudge; measured balance
metadata:
  type: project
---

PvP finish or spare lives in `src/sim/mercy.js` (#657, epic #626 slice 4, 2026-11-03).

- An enemy hero's blow downs (goDown no longer short-circuits heroes); `pvpDowned` gives the victor the choice. Scripted: one rnd(), odds .5 x bold / mercy, x1.5 if the downed had sworn on them, clamp .1-.9, a sworn nemesis is always finished. Agent victor with a live runner (`!reflexMay`): urgent event, `finish`/`spare` tools, MERCY.WAIT 30 game min, then reflex. **Why:** owner answer 3 on #626.
- `slay(a,k,{finish|bled})`: finish = credit + whole-guild grudge at any level; bled (downed by a hero, died of saves) = no honour/XP/gold, normal 12+/party grudge, cause "bled out after X struck them down" (balance scripts still count it PvP). Any hero blow on a downed hero counts as a finish.
- Spare = stable at once + `a.debts[sparerId]`; debtor never charges/duels/assists against the sparer; repays once in `debtTick` (sparer downed within DOWN.REACH -> aid; sparer below 50% vs a mob within 8 -> joins). Debts to the dead lapse.
- Landmarks come from record() lines matched in tiers.js RX ("Spared ", "Was spared by ", "Repaid the life owed", "Finished ... where they lay.").
- Test pitfall: `pop()` draws one rnd() before the victor's die, so forced dice need a filler (`forced.push(.5, x)`).
- Measured 10x120 vs main: PvP share 26% vs 37%, PvP deaths 5.2 vs 6.9, deaths/h 10.2 vs 9.3 (Crypt 10.9 vs 6.3, likely noise), Fellowship deaths 1.8 vs 0.8 (all-Crypt suspected, unconfirmed); ~4.2 finishes and 2.4 spares a run; repaid/held/bled 0 in scripted runs (victors decide at once, debts rarely meet).

Related: [[downed-saves]], [[guild-rivals]], [[mirefen-pvp-dynamics]]
