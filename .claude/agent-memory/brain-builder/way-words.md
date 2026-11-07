---
name: way-words
description: "#797 ground.js: route facts and way words for look, survey, move_to, hero survey tool, sight gating, header brief.way, waycheck pitfalls"
metadata:
  type: project
---

`src/sim/ground.js` is the one reader of the solid layer and the route, for heroes and the DM: groundScan, groundLines, routeFacts, wayWords, wayShort, betweenWords, wayNow. dmsight survey uses the same scan.

- Heroes got a `survey {to?}` tool (issue named it; heroes had none). `peekPlan` sets PEEK so plan() uses `zoneNear`, never zonePoint: zonePoint draws RNG.
- Sight gate: `sees(a,x,y)` = in sight or region known. Unknown crossing has `crossing:'unknown'` and no tiles; unknown bar `blocked:'unknown'`.
- Header: `brief.way` only while blockAt still finds something on the line to `a.path` target. a.path is null until the first step after an order, so look straight after move_to has no your_way.
- #746 (open-world Table) is unbuilt, so that done-when box of #797 was left to it; it should read groundScan.

**Pitfalls:** `a.lore` is lazy: knownNames falls back to ALL zones when it is undefined, so call loreOf(a) first (placeWays does). A test that forgets lore must clear `a.playDoing`, which still names the old walk. Bash heredocs with backticks and quotes failed; write edit scripts with Write into the scratchpad.

**How to apply:** new walk answers go through `wayOf` in player.js; never write obstacle words anywhere else. Related: [[dm-visibility]], [[places-tool]], [[tool-quickwins]].
