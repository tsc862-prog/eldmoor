---
name: followed-pause
description: #458 followed-company pause - stopsWorld/pauseAll in sim/table.js, live-clock banner line and the vPause setting in ui/table.js
metadata:
  type: project
---

#458 (epic #402): at 1x only the followed company's Table scene stops the world.

- Sim (out-of-area, ai-designer's table.js): `stopsWorld(sc)`, `pauseAll()`, `setPauseAll(on)`. `tableHold` = `holdStep(dt) && stopsWorld(S.table)`, so an unfollowed scene still runs its phases/waits (sc.pause stays true) while the world steps. `S.pauseAll` exists only when on (deleted when off) so seeded hashes and old saves are untouched. bannerOf adds `live`, `where`; `paused` now means "stops the world".
- There is still ONE `S.table` (#440 queues other companies in `C.tableQ`), so "one line per other open scene" is at most one line.
- 3x/8x unchanged: any company whose agents decide still sets TABLE.drop (issue text wins over the doc's "followed only").
- UI: `liveLine(b)` -> one `.tlvb` button "Scene at <region>: <leader> and company" (data-act=live, same handler as follow); chime fires only when a scene stops the world. Settings row `vPause` ("Pause: followed / any company") hidden unless 2+ companies.
- Not done: members/foes of a live-clock scene are not held in place ("engaged") as the doc asks; world combat runs beside the scene.

**Why:** owner decision 4 on PR #406 (apart worlds must not stall).
**How to apply:** any new "is the world paused" check should use `stopsWorld`, not `sc.pause`. See [[company_frames]], [[table_legibility]].
