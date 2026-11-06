---
name: town-errands
description: #727 rules - agent arrival in town is a now wake + 120 min leave-town hold; errand aims are wait orders in town; already-here answers; forced stale-aim drop; errand-unacted anomaly
metadata:
  type: project
---

Rules added for #727 (a solo gpt-6-luna hero kept walking to Highgate "to ask", autopilot walked it straight back out):

- Arrival in a town on the agent's own order (move_to, or the aim's walk: intentPilot move cmds carry `aim:true`) is a w=2 event and sets `a.playArrive`; `leaveHeld` blocks only the leave-town steps (hunt_region in town, an aim's hunt out of town) for `TP.ARRIVE_HOLD` 120 via `stayCmd` (a rest with `hold:true`). Rest, sell, buy still run.
  **Why:** the idle clock was already past PK.IDLE on arrival and "Arrived" was a soft wake, so autopilot left before the turn.
- `rest` cmds with `hold:true` do not end at full HP and post no "Rested" event (the aim's wait order uses it too; before, a wait at full HP ended every step).
- Errand words (`errandOf` in intent.js: ask/info/directions/learn, buy/sell, trainer, board, rest) -> `{kind:'wait', errand, town}` in town; untilAt defaults to `INTENT.ERRAND` 240. A move aim with errand words converts to that wait on reaching a `last:'town'` place instead of ending.
- `intent`/`move_to` naming the town the hero stands in: "You are already in X" + `localsNear` people + tools, no walk.
- Forced reflection intents carry `forced:'yes'` (local-agent reflectTurn); a verbatim copy of a finished aim (`a.intentPast`, 6 kept) is dropped, flag `stale-aim-dropped`. Only forced: an agent restating an old aim in a free turn is honoured.
- `errand-unacted` (behavior.js): errand aim (not rest) held in town ended with no talk/list_jobs/buy/sell/earshot/learn_profession. Mind comparison got `no-aim` and `errand unacted` columns (mindSection takes A); behaviorcheck's column count is 22.
- I kept #466's no-aim fit-ground hunt after the hold; the issue's "only when the last order was a hunt" was read as "no live aim order", so townpilotcheck's town section still holds.

**How to apply:** new town autopilot steps that walk out of town must check `leaveHeld(a)`; all of it is agent-only, hashcheck stayed equal.
