---
name: world-events-hooks
description: #10 done-when - start_event posts per-faction adventure hooks, endEvent records faction stats and DM log, 3-day cooldown
metadata:
  type: project
---

start_event (src/sim/events.js) now posts one hook per faction (EVENT_HOOKS per kind, templates gated by region band high >= template lvl, nearest town of each faction, via the post_hook lever, tagged h.ev = condition id). On expiry endEvent (provided to levers.js expire) counts hooks into facStats[f].events / eventsDone, withdraws open ones, writes a dmlog 'event' entry and starts EVENT_COOLDOWN_DAYS (3) via S.worldEvent.lastEnd.

**Why:** the issue's done-when list; only a lever pull starts events (the scripted DM never does), so the seeded world hash is unchanged.
**How to apply:** tests that start several events in a row must reset S.worldEvent = null (levercheck does). dmlog summary must be an array of parts.
