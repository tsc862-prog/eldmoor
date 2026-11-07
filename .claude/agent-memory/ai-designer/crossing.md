---
name: crossing
description: Linked maps #1013 slice 3: crossing.js rules, why the road is words not proximity, atlas leaf for player.js and dmagent, tick at the head of step, parked whens, fixture traps
metadata:
  type: project
---

`sim/crossing.js` is the crossing; `sim/atlas.js` holds what other modules read of it (roadWord, exitNamed, crossingBrief, crossingView, campaignMaps, oathZone, townNear). Rules added and why:

- A road (`C.road`) is written only by the leader's tool call that names it (`roadWord` in `playerAct`), never read off position or autopilot. That is the whole of "not on proximity" and "not again until ordered anew": wait and turn_back delete it, and only a new call writes it. An old aim that autopilot carries writes nothing.
- An order's road dies with any plain command elsewhere; an aim's road survives a hunt on the way and dies with a new aim, `intent {done}` or its time running out. Arriving ends an aim, so roadHolds must not read `I.done` alone.
- player.js and dmagent.js must not import crossing.js: it calls setSceneKind at load, and an early import through the cycle would hit table.js unevaluated and shift module order. Everything they need is in the leaf atlas.js; index.js imports crossing.js last.
- `crossingTick` runs right after tableHold, before `S.gameMin` moves: the rest of the step then reads the new map, and rebuild() comes after it. The scene's outcome only sets `R.phase='go'`; `cross()` runs the next tick once the scene is closed.
- No reflex crosses: `reflexMay` (owner resumed) may say go, a live agent that timed out says wait.
- Staged scenes are not a hold, because a hold's words would tell heroes a cast is coming: `leaveBehind` unstages it and the DM log says so.
- Whens: place-bound ones go to `S.dmAgent.when.parked[map]`, not `S.maps[map]`, because unpackMap deletes the frozen map before the crossing could read it. On return `until` shifts by the time away and `st` is baselined again.
- `notes_write` has no tags: the DM's plans for a map are found by the map's name in the text (`plansFor`).

**Why:** a paid five-mind scene must never open by accident, and a new map must never open in silence (#1017, review points 1 and 2).

**How to apply:** slice 4 reads `crossingView()` for the banner and needs `onWorld` in render. Slice 5 must teach heroes the exit names: today `move_to` takes an exit's name from anyone, and a place beyond only if `knowsPlace`, but no tool lists exits to a hero yet. `a.quest` kill quests and `C.plans` keep old-map names; harmless, not resolved.

Fixture traps: `init()` on testlinka has one fac-0 town; a fake adventure needs `data:{}` and its scene away from the road or questTick takes it up and dmTravel crashes on the stand-in; `F.camp` set by hand lasts one step (campTick drops it), so check holds after steps(1); a replay in a fresh process must `restore` in the original too, as `--away` does, because the pool of used names is not saved and `ensureNpcs` on a new map draws by it.

Related: [[map_pack]], [[map_rebind]], [[no_lair]], [[first_delve]].
