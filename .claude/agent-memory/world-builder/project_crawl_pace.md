---
name: crawl-pace
description: #264 crawl pacing: rounds 2, XP per room, room hits retuned; why 2 rounds needed fewer foe hits and a reflex change
metadata:
  type: project
---

Crypt crawl rooms use `rounds:2` and XP is paid per room won (`CRAWL.ROOM_XP`, clear payout / rooms) plus a 10% clear bonus in `payClear(g, share)`.

**Why:** the lead wanted scenes per Crypt attempt down 40%+ and Fellowship level at 120 min within ~0.3 of main. With 2 rounds and the old foe `hits` (6+ blows in the gallery, 8 for the boss) the party never cleared (0 clears over 4 runs, level 14.6 vs 15.9). Reflex scouting in round 1 also wasted acts (now only if foes need `SCOUT_MIN` 6+ blows).

**How to apply:** a room is winnable in 2 rounds only if foes need about 4-5 blows total (5 members, ~half strike, ~55% hit). Tune room `hits` in spec.js, not `hit`. Measured: scenes/attempt 17.3 -> 7.5, level@120 15.65 -> 15.75. `scenes` is now tallied in `S.fellowship.crawl` and the sim summary. CRAWL_BASELINE_HASH must be the whole line tail, e.g. "-339844489 guilds:28".
