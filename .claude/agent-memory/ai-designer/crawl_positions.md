---
name: crawl-positions
description: Crawl positions #744 - cr.pos tiles from sim/roomgrid.js, move on scene_act, room in words; why agents stay put on plain acts and what #745 must know
metadata:
  type: project
---

#744 (slice 2 of #140's named positions): `src/sim/roomgrid.js` owns spots, the room grid, `resolveMove` and `roomWords`; `cr.pos` (room `cr.posR`, foes keyed `f<index>`) is the truth and the dungeon view only reads it.

**Why these rules:**
- Grid = the chamber's box in the real interior, room-local tiles, so words and view agree. A site's interior moved to `world/siteinterior.js` for that (cave cuts change floor; sim may not import render).
- A move lands inside scene_act (pre-answers build the formation); a refused move leaves the act unsaid; the forced runner retries once without the move so a bad phrase never loses the act.
- Agent with no move stays put except guard, hold, retreat (issue text); reflex/silent agent uses full `spotFor` (the #742 table). `act.moved` beats any implied move.
- POS.STEP 3 caps reflexes too, so strikers often do not reach the flanks in a 2-round room: truthful now, and #745 must weigh reach against `rounds:2` or strikers will never land.
- Room words are not in the notify texts (tokens): only tableView and the pace brief.
- `move` in a non-crawl scene is noted (`move_note`) and ignored, not refused.

**How to apply:** no RNG in roomgrid (hash proof). Fixtures: Fellowship members are already agent-played, calling `markPlayer` on them after `descend()` drops them out of the crypt; links must be 'connected' only in crawl scenes. Bash heredocs with quotes broke in this shell: write scripts with the Write tool. Related: [[table-rounds]], [[check-fixtures]], [[table-rescue-saves]].
