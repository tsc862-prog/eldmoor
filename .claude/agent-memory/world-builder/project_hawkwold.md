---
name: project-hawkwold
description: #1013 7c third chapter map (id hawkwold, 150x66, levels 6-11): layout, the bridge not ford, crawl tuning numbers, crossingcheck --real-fell
metadata:
  type: project
---

`HAWKWOLD` in spec.js: Hawkstead (north bank, Vale plan, x0 54) and Hornridge (south bank, x0 124), regions foldlands 6-8 / hawkrise 7-10 / hornmoor 8-11 (ids differ from the Vale's `hawkwold` FAUNA key on purpose), one Wend Bridge at x=100, Herders' Cairn (entry 6, three rooms) and Kestrel Barrow (entry 7). Hollin `east` <-> Hawkwold `west` is the Fell Road; Hawkwold `east` (the Hawk Road) has no far side.

**How to apply:**
- worldcheck wants a continuous road between towns, so a ford did not do: a stone bridge (`scenery.bridges 'x,y'` with y the river's first tile at that x) does.
- Gate to gate is 75 tiles, 152 game minutes; the first layout (40 tiles) read as compacted, so towns were pushed apart.
- Cairn rounds 2,2,2 gave driven back 25% at L6, 17% at L7 (60 crawls each); the Vale's Kestrel rooms as they are: 15-20% at L7-8. Deaths and downs were near zero in both with reflexes. At rounds 2,3,3 the Cairn was only 5-10%.
- crossingcheck `--real-fell` (XROAD=east env) is the Fell Road leg; the exit helper takes the Hollin exit by id, and `at()` clamps x so a west exit works.
- Shot script idea: tile colours straight from `buildWorld` through scripts/art/png.mjs encodePng, no browser.
