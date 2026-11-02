---
name: agent-limits
description: In-game agent limits (#145) - Agents popover, per-viewer limit store, supervisor /play/runner/limits semantics
metadata:
  type: project
---

- **Page:** `src/ui/agents.js` provides the Agents popover. It has a session budget select with the spend, and one row per runner (fellowship, `hero:<id>` for each agent-played hero, dm). Each row has a turn cap and, unless the runner is local, a budget. `src/ui/runners.js` keeps limits in localStorage `eldmoor.agentLimits` as `{runners:{key:{turns,budget}}, session}`. `pickBody` sends them with every start, `setLimit` posts them live to a running runner, and `syncSession` re-sends the session budget when a relay restart forgot it. Turn caps are no longer in `runnerPick`; the Agents panel is the one place for them.
- **Supervisor** (`scripts/runners.mjs`):
  - `POST /play/runner/limits {sessionBudget}` / `{key, maxTurns, budget}`.
  - Spend comes from the `| run $x` lines, counted as deltas into `session.spent`.
  - A paid start's budget is clipped to what is left. A spent budget gives a 402 on new paid starts and stops every paid runner (local ones play on).
  - A live cap is enforced by `checkCaps()`. Fellowship turn caps only apply on the next start, because its turns count across members. A raise above the child's own CLI cap means `applies: 'next start'`.
  - The stop line `stopped after N turns (reason: ...)` feeds the reason in runalert's `reasonOf`. Keep parentheses out of the reason text.
- Tests are in runnercheck ("limits set in the game") and uismoke ("Agents panel", with a mocked fetch).
