---
name: camp-rest
description: #178 camp rules - status text, break_camp vote, leader rest {hours}, wake events, sleeper pacing, onCamp hook for #179
metadata:
  type: project
---

Camp (sim/camp.js) now has: `campView/campStatus/campSummary` (doing line, agent status.camp and pace brief, Fellowship panel line), `asleep(a)` (resting and not the watcher), `break_camp` proposal kind (council.js; reflex votes yes only if all >=90% HP) plus leader tool `break_camp`, leader `rest {hours}` (why 'rest', breaks itself when time is up), a mended-before-dawn wake event (w=2, once per camp), a w=2 "Camp is broken" event to every member on any break except an ambush (the alarm is the event), groggy sleepers (a.cd=2.4) after an ambush, and `onCamp(fn)` for #179 reflections (kinds make, rest, mended, spotted, caught, break).

**Why:** the owner was left waiting through long night camps with no idea how long, and agents idled on autopilot when camp ended. Silence still keeps the dawn rule.

**How to apply:** pace.js suppresses soft wakes and heartbeat for sleepers only; w>=2 events (proposals, alarms, mended, break) still start their turn. Camped heroes skip playerUpd, so camp.js writes a.playDoing itself each tick.
