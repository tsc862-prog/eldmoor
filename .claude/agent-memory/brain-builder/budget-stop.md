---
name: budget-stop
description: #807 cause (owner's gate clicks, not adopt) and the budget-stop protocol: budgetOut, active.json spent, events.jsonl, by/why, price on buttons
metadata:
  type: project
---

Finding on #807 (sitting of 2026-11-04): adopt, resume and crash paths started none of the 07:28-08:29 runners. The gate's Restart/Start/Start all did, with no price on them. Tell-tales: resume bursts within ms with --provider; page starts with nothing picked have no --provider and are seconds apart.

- Marked in `take()` from the runner's own line, or in `stop()` when why starts "budget reached"/"session budget reached". Those lines are a contract: `[Name] done (budget reached)`, `[agent|dm] stopped after N turns ... (budget reached)`. Changing them breaks the stop.
- `spentOut` map, saved as `spent` in active.json; a non-automatic start deletes the key; resetAll clears it. `AUTO_START` starts are refused 402 on a spent key.
- There is no crash restart in the supervisor (none since #691); "a crash still restarts" only means a heir's seat.
- Not done: a runner alive at a relay restart resumes with a full budget, not what was left.

**Why:** owner treats dollars as the limit (#563), and the hard rule keeps the world paused without a runner, so the click must stay.
**How to apply:** report on runner spend from `logs/runners/events.jsonl`; a new way of ending on budget needs the same line or a stop why. Related: [[app-runners]], [[company-runners]].
