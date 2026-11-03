---
name: stated-aim
description: #535 intent tool - a.intent shape, order mapping for autopilot, stale/done rules, header ask text, leader shout, no-aim anomaly, test pitfalls
metadata:
  type: project
---

#535 (2026-11-02): agents state their aim with `intent {goal, why, until?, done?}` (src/sim/intent.js; tool handler, order
mapping and leader shout in src/sim/player.js near intentPilot/orderOf/goalOrder/shoutAim).

- Shape: `a.intent = {goal, why, until, untilAt, set, prog, snap, order, done, n}`; `a.intentSeq` counts aims (behavior digest
  `intents[name]`, baselined with `iseq0` like memories' seq0); `a.heardAim = {id,name,text,at}` on companions who heard the shout;
  `a.aimShout` stops the same text being shouted twice. purpose.js (#534) reads goal+why and `order.to`.
- States: none / set / stale (no progress INTENT.STALE 120 game min; progress = kills, XP, level, adventure step, 4 tiles; camp,
  fight, crypt, table and a wait order count as progress) / done (untilAt passed, arrived within 3 tiles of a move order, hunt n kills,
  followed hero gone, `done: yes`). `aimHeld` = set or stale (autopilot still carries a stale aim).
- Order: the agent's current/next command (move_to keeps the raw target for re-planning) else goal words (waitish -> wait, "follow
  <first name>" in sight, longest known place name; hunt words + region -> hunt). Autopilot calls intentPilot after hurt/storm in the
  field and after rest/sell/buy in town (before the follower's leader wait). Follow maps through `a.playOrder` (standingFollow).
- Header: `brief.aim {state,line,ask,why,wait_limit,leader}`; `aimNote` asks "What are you trying to do now? ... Say it first with
  intent {goal, why, until}" unless a scene/table is open. CLAUDE_TURN_ORDER says answer with intent first. Reflection forced schema
  has an `intent` object (strict required), `reflectIntent` parses, reflectTurn sends it; empty goal keeps the aim.
- wait with no held aim is capped at 120 (checks never wait above 120 without one: safe).
- Pitfalls: playcheck's world is unseeded (Math.random), so loops that wait for an anomaly must poll until it appears (a camp or fight
  resets the no-aim clock). behaviorcheck's A had until 12 h but the run is 14 game hours: use 48. Seeded hashes (professioncheck
  --hash, tablecheck --hash) were unchanged vs origin/main extracted with git archive.

Related: [[own-persona]], [[standing-orders]], [[behavior-logs]], [[reflection-moments]].
