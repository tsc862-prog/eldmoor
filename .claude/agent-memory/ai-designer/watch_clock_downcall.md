---
name: watch-clock-downcall
description: #655 death slice 2b - Watch-mode downed clock (WATCH_TICK 20, urgent kin wake per save) and the DM's downed table_call in downcall.js; gates that keep seeded hashes put
metadata:
  type: project
---

Slice 2b of the death epic (#626), after [[table-rescue-saves]] and [[downed-saves]].

- **Watch clock**: `DOWN.WATCH_TICK` 20 replaces `DOWN.TICK` 10 only when table.js's `onWatch` test holds: `TABLE.mode==='off'` and `a.player` and `hasLinks()`. **Why:** owner answer 2 (agents need time to act with no table rounds); the hasLinks gate means npm run sim and every seeded hash never take it (hashcheck all equal). `tickOf(a)` is read at lay, at each save and in toWorld.
- **Companions' urgent wake**: each Watch-mode save notifies kin agent heroes within `DOWN.REACH` (urgent 2, saves made/failed, the stabilize hint). Only kin in reach: the in-game channels rule forbids telling companions far away.
- **DM's downed call** (`src/sim/downcall.js`): downed.js reports down/save/end through `onDownNews` (end = tellNear's kinds, so mercy's 'finished' counts). Calls only for agent heroes, with hasLinks and an open DM seat. Non-blocking (world and scene go on); one waiting call per hero, `PER_DOWN` 4 a downing (saves skipped when one waits or room is short; down and end always), `PER_DAY` 30. Ids start at `ID_BASE` 1000 so `table_answer` can tell them from a scene's own calls; dmagent asks `downCall()` before `sceneCall()`. Fill: TABLE.dmMs from pickup (#680 callDeadline), `WAIT_GM` 30 cap, or at once when nobody listens ('gone'); fills log fill:true. Line goes to the hero's scene (sc.ids, sc.narr) else to `hearersOf(a)` plus the downed.
- `fellowship_needs`/`companies_needs` list a downed member first and leave them out of "badly hurt" (sort key still treats them as hurt).

**How to apply:** wounds (#656) and UI (#659) are next; a new down-related event belongs in tellNear so the DM call sees it. Check fixture: downcheck section 10 needs `setRunnerLinks(()=>'connected')`, `setDmSeat(true)` and `heard('table')` for a waiting call; reset all after.
