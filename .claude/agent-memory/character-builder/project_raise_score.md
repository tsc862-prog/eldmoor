---
name: raise-score
description: #714 agent score growth - raise_score tool, a.growPending, GROWTH.HOLD, why hashes stay equal
metadata:
  type: project
---

Agent heroes with a live runner (`agentLive`) get a pending point at L5/10/15/20 (`levelGrowth` in sim/abilities.js, `a.growPending [{lvl, at}]`); `raise_score {score, why}` spends it; `growthTick` (top of playerUpd) takes the class default after `GROWTH.HOLD` 24 game hours or when `reflexMay` (no runner).

**Why:** hashes stay equal because runner-less sims (no links) and scripted heroes call `growScores` at once with the same rnd use. Do not move the growScores call for runner-less agents.
**How to apply:** stats.js cache already keys on abil values, so a raise needs no invalidation. Check: `npm run scorecheck`.
