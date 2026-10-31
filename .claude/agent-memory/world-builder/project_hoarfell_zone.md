---
name: hoarfell-zone-design
description: Design decisions behind Hoarfell (zone 3, frozen north strip, levels 16+) added 2026-10-31 - placement, boundary, label spots, tile-mix tuning
metadata:
  type: project
---

Hoarfell is zone 3: a northern strip east of the river (`x >= riverX(y)`, `y < hoarY(x)`), carved out of the top of Mirefen and Cinderpass. Level ladder is now Thornvale 1-5, Mirefen 6-10, Cinderpass 11-15, Hoarfell 16+.

**Why:** the parent task fixed the placement, zone index, level bands, tile types (SNOW/ICE) and label positions up front; Kragmaw's lair (71.5,25.5, r 5.4) must stay in Cinderpass, so the boundary is capped well below y=16 (actual range y 10-14).

**How to apply:**
- Zone label positions were deliberately moved: MIREFEN (38,19), CINDERPASS (63,18), HOARFELL (52,5). Keep labels clear of the KRAGMAW label at (LAIR.x, LAIR.y-3) and the (40,25) crossroads.
- Hoarfell uses a *higher* PEAK threshold (fbm > .68) than Cinderpass (.6) because the fbm field runs high in the north; at .6 the zone was 38% mountain. Tune that number, not the shared fbm seeds, if the snowfield-to-peak ratio needs changing.
- The north road (40,25)->(46,17)->(52,8) only puts ~5 road tiles inside the zone; extend it if heroes seem to struggle to reach Hoarfell once mobs exist.
- Any array indexed by zone (ZPTS, EPICS, ZONES) must have four entries now.

Related: [[eldmoor-map-layout]]
