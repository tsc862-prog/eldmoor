---
name: engaged-scenes
description: #518 several open Table scenes (S.table primary + S.tables by company id, sim/scenes.js) and the engaged hold for live-clock scenes; why, invariants, test pitfalls
metadata:
  type: project
---

#518 (epic #402): each company holds its own open Table scene at once, and a live-clock scene holds its people.

- **Layout:** `S.table` = primary scene (the one that stops the world if any, else first opened); every other company's
  scene in `S.tables[companyId]`, deleted when empty so a one-company world saves/hashes as before. `place` on open,
  `closeScene` promotes the next (stopsWorld first, else lowest id), `primary()` each tableHold swaps in the followed one.
  **Why:** dozens of readers (banner, scene map, camp/crawl/staged "is a scene open") still read `S.table`; keeping it
  always set while any scene is open made those safe without touching them.
- **Hero-context readers use `sceneOf(a)`** (src/sim/scenes.js, imports only state.js so heroes/mobs/pvp/chat can use it
  without a table.js cycle): sceneAct, tableView, scenewait, pace sceneOpen, player vote/wait/scene_act, dmagent whisper
  and narrate, bridge/headless `table` flag. Company context: `sceneFor(C)` in table.js. Staged lookups: `findScene`.
- **C.tableQ** now only for a merge's paired vote while that company's own scene is open (#500); tableTick opens every
  company's due moment the same step.
- **Engaged:** ENG set rebuilt each `tableHold` from scenes with `pause && !stopsWorld`, kinds other than boss/site/room/
  crawl (raid and dungeon run in the world); members not in `sc.out` plus `foesOf` (not the boss). Held = skipped in the
  index.js agent and mob loops, excluded from findMob, pickPrey (lore.js), mob aggro, pvp `free`; a non-held mob drops a
  held target, a non-held hero drops a held fight/assist target. Held mobs keep `hpl` untouched so guard applies on release
  as in a paused world. **Why:** in a one-company world stopsWorld is always true, so ENG stays empty and hashes hold.
- Test pitfalls: decisionsWaiting only lists turns-scene members in phase 'turn' (step past 'frame' first); a merge
  proposer's own vote already counts, its scene_act returns an error; `close()` (mode off + tableHold) resolves ALL scenes.

Related: [[table-per-company]], [[merge-vote-scene]], [[company-model]].
