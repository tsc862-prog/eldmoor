---
name: mapswitch
description: "#1013 slice 4: render follows a map switch; roadfade beats, what each hook must do, how to stage a crossing and prove it, traps found"
metadata:
  type: project
---
A map switch happens inside `step()`; render never reloads. Every render module has an `onWorld` hook that only clears (no DOM, no building), `roadfade.js` covers the handover (out, dark, lift, in; in the cinema view `director.enter` is the last beat) and builds the far side in the dark.

**Why:** Node cannot reload, so the switch is one process; hooks fire in the sim's tick, also from `restore()` before any renderer exists and in crossingcheck with no DOM.

**How to apply:**
- A new render table sized or built from the map needs a hook, and a `warm*` step in `roadfade.js` STEPS if it is heavy. `npm run rulescheck` now scans `src/render` (mapcapture LAYERS); `src/ui` is not scanned (too many false memos), so UI captures are by hand (`ui/region.js`, `ui/mapswitch.js`).
- `resize()` assigns `cv.width` and so clears the canvas: take the picture before it. That made the road's end black in every first shot.
- A chunk's row of tiles can take 20 ms, past the 7 ms slice: idle painting during a fade drops frames, hence `warmRest`.
- Staging: `?world=testlinka&continue=1`, `import('/src/sim/crossing.js').cross(C, exitById('east'))`, or `mappack.js` `switchMap('vale')` for a size change. Set `FADE.OUT_S`/`IN_S` to 3 to catch a beat in a shot (CDP capture is slow). A fresh profile's hidden setup page holds saves: `holdSave(false)` before `writeSave()`.
- Proof that counts: `crc` of `getChunk(x,y)` against a fresh page of that map. Keep samples inside `CHUNKS_X/Y`: out of grid gives a nonsense chunk that still matches.
- A stale-table check must paint each map on the way, and go between two maps with a scenery note (hollin, vale), or the mutation passes. Mutation-test such checks. See [[gpuframes]], [[previews]].
- MOBS is per map (fauna.js): 16 of 18 Vale types are gone on the fixture, so a carried `a.quest.type` may have no row. Guard reads in render and UI.
