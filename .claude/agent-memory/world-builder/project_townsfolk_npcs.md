---
name: townsfolk-npcs
description: Issue #28 townsfolk design - six roles per town from the spec's `spots`, S.npcs plain JSON, chat-rate tuning (REGREET a game week, GREET_P, gated open/close), save-walker gotcha for chat `from`
metadata:
  type: project
---

Townsfolk (issue #28, branch world/npcs): every town staffs one NPC per role in
`src/data/npcs.js`; `src/sim/npcs.js` runs routines, greetings and the two reactions.
Posts come from the spec's town `spots` ([dx,dy] offsets; `gen.js` fills defaults from
fractions oriented by the gate side, and `ah`/`qg` now *are* `spots.quartermaster` and
`spots.gate`, so heroes.js needed no edit).

**Why these numbers:** the brief asked for 20-60 NPC lines heard per real hour across
both towns. First cut (REGREET 240 game min, GREET_P .5, unconditional open/close) gave
435/h; open/close alone was ~300/h because twelve residents announce at every 06:00 and
21:00 while heroes idle in town overnight. Final: REGREET = 10080 game min (a game week),
GREET_P = .12, open/close only with a hero within 3 tiles and one roll in four -> ~47/h
(27 greets, 4 songs, 9 blessings). Greets are driven mostly by *new recruits* (each new
hero meets 3 posts), not by repeat visits, so GREET_P changes move the total slowly.

**Gotchas:** (1) `sim/save.js` walks every object in S; a hero chat entry's `from` must
be a small stub `{kind:'npc',id,name,fac}`, never the live NPC, or the whole NPC (met map
etc.) is copied into every buffer. (2) At the Kragmaw kill tick boss.js has already sent
raiders home (`raid=false`, state return), so credit = highest living hero of that faction
within 9 tiles of the boss. (3) `ELITES[zone]` names the elite a hero just killed (one
named elite per zone); `S.eco.stats.eliteKills` delta + per-hero `eliteKills` finds the
killer without touching mobs.js. (4) Gate captain has `hours:null` (always at post) so the
quest-giver stop is never empty; innkeeper keeps 08-24.

**How to apply:** new towns only need `spots`/`npcs` in the spec (or nothing: defaults).
Rate tuning lives in the constants at the top of `sim/npcs.js`; measure with a scratch
script reading `S.npcNews.stats` over `npm run sim`-length runs before changing them.
Related: [[world-spec-generator]], [[road-encounters]] (same single-line hook style).
