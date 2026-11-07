---
name: project-hollin-reach
description: #1013 slice 7a the first chapter map (id hollin, 118x64): owner's density rule, one town, spec flags chapter/sides, closed exits, what is open with him
metadata:
  type: project
---

`HOLLIN` in spec.js: one town (Oldstead), Hollinlea 1-3, Withywood 2-4, Crowfell 3-5, the Withy closing the south (no crossing), first delve (the Tithe Grange) at the wood road's end, two exits `to:{map:null,heard}`. Non-default.

**Why:** owner 2026-11-06: maps are PART of the world; "I don't want the tile set to get smaller ... encompass less and not be so compacted"; other faction absent, nothing above level 5. Density is the design number, not size. The coordinator decided (2026-11-06) to include the Quarry Cellars (Crowfell, entry 3): level 3-5 companies need somewhere to go until the roads open. A road ending "not yet open" is the working plan.

**How to apply:**
- A chapter map: `chapter:true` gives `LVL_CAP` (map.js; spawnMob, bandLvl, seasoning clamp to the top band) and drops the great-dungeon demand; `sides:'lore'` opens the town to any company (worldcheck rest check); a faction with no town gets no roster.
- A town's `delve:[x,y]` stands its first delve at a road's end, past the siteSpotErr road gap. `roadClear` and `glades` fell trees: crowns stand 3 tiles over the root and hid the wood road from above.
- Biomes `lea` (few trees) and `wood`: meadow's 29% trees read crowded at cinema zoom.
- A region may have no elite: FAUNA row without `elite`, ELITES then packed with `z`, read through `eliteOf(z)` (data/mobs.js).
- Next map: the exits' `to` get real targets; a map:null exit fails worldcheck on a `final` map.
