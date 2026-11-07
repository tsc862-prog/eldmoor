---
name: map-knowledge
description: #1013 slice 5 what heroes and the DM know of other maps: farlands.js, roadOf/hopsTo, manyMaps gate, enter_map, parked action whens, quests and marks across maps
metadata:
  type: project
---

Slice 5 of #1013. Gate: `manyMaps()` in atlas (an open road, or `S.maps`); a chapter with closed roads only (Hollin) still shows roads in look/list_jobs but no land words. `EXITS` empty = every helper returns nothing at once, so seeded hashes hold.

- Hero side `src/sim/farlands.js`: roadsSeen (look), gateRoads (list_jobs, teaches road + far map + its first town), roadsKnown (places `roads_out`, `kind: road`; no new tool, so no text in a one-map prompt), farWay (plan), farAnswer (talk), boundWords (leader's word after a crossing).
- `roadOf(text, knows)` in atlas: {e} | {e,bound,map,hops} | {lost}. Route goes only through lands the hero knows a name of (`hopsTo`); one hop per crossing, each needs a new order. `C.road.bound` carries the far name to the farside scene's ctx.
- Crossing leaves behind: kill quest -> `a.questsAway[map]` (quests left_behind, back on return; before this `status` named the wrong region, and would throw where fauna differs); open meeting plans -> status `left` (else "came and went" chronicle line, false); marks and DM places stamped `e.map` (`spotHere`), walked to by the road home; friendly towns learned by name (they were only implied by CITY).
- DM: `landHead()` on survey/regions, `farHint` inside `nameHint` (one place for refusals), campaign roads with levels/towns/blurb/then, `empty_land`. `when`/`watch` trigger `enter_map {map}`: hours up to `WHEN.MAP_H` 240, default 240, action not checked at set time when the map is not live, fires after the farside scene. `parkWhens` also parks a when whose action args name a place or person of the land left (`actsHere`), enter_map excluded.
- Prompts: `status.land` -> `ordersFor(text, sides, land)` / `withSituationOrders(..., land)`; DM `dmMapOrders(st)` from `st.campaign.roads`, `withDmMapOrders` for old sessions. `enter_map` is the one word in a one-map prompt (the trigger enum in dm-tools must match TRIGGERS).

**Pitfalls:** `lorePlaces` capture must filter far names or the stale-capture check fails. A `//` comment sed-inserted into these one-line statements swallows the rest of the line. In a JS template literal `\'` becomes a bare quote: writing edit scripts, avoid apostrophes in quoted code. A company camps by itself during long `steps()` in tests. Related: [[in-game-channels]], [[dm-when-watch]], [[hunt-where]].
