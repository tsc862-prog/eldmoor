---
name: dm-visibility
description: "#558 DM reads hear/survey/world_standing, carries/quests/knows on member views: ring storage, filters, hint wiring, check pitfalls"
metadata:
  type: project
---

`src/sim/dmsight.js` (read-only helpers) is wired by `dmagent.js` (dispatch cases, `unheardOf`, `seeItems`, `surveyRead` resolver, a survey hint appended to ground refusals of mark_place/place_person/stage_scene in `dmAct`).

- `hear`: ring `S.dmAgent.ear {seq, lines[], keys[]}` (200 kept), filled by `listen(D)` from agent heroes' `a.chat` (speaker `kind==='hero' && player`, not `e.dm/npc/whisper`); called from `dreamTick` every 3 game min while the seat is open and before every hear/dm_status. Lines keyed min|id|text so many hearers add one. Default returns unheard (`h` flag), `since` (game min ago) or `n` reads back. Kinds say/shout/table. NPC lines left to `npc_call`.
- `dm_status.unheard {total, by_company, note}`; `seeItems` puts "they spoke N lines (hear)" and "X carries <quest items>" into fellowship_needs / companies_needs items (quiet flag untouched).
- `carries` (gold, gear, quest_items names, potions, scrolls, pack count), `quests` (kind,title,status,focus), `knows` (lore.js `loreSummary`, new read-only export, plus talk.js metNames) via `sightOf(a)`.
- `survey`: tile scan by 8 compass directions, `legal_spots` (6 max) are rings that pass `spotErr`, 3 tiles from places, spread; open ground first.
- fellowship_view now drops stances the hero wrote itself (`persona.stanceBy[id]==='self'`).

Pitfalls: the ring sorts by minute, so a test line with a far-future `d` pushes real lines out of the cap; `secret()` in channelcheck is fresh on every call (keep it in a const); mark_place limit of 10 active blocks the spot-acceptance test unless `S.levers.active` marks and `S.places` are cleared first. `bMemory/bLong` (memory.js digest) stay visible in fellowship_view by old design.
