---
name: project-vale-towns
description: #940 slice C Vale town plans: kit footprints, ground option, rise rule, npc home standAt, Gullstrand via road
metadata:
  type: project
---

Vale towns use spec `buildings: townPlan(x0,y0,[[piece,dx,dy]...])` (helper and `TOWN_KIT` in spec.js) plus `ground:[[dx,dy,w,h]]` (new gen.js option: ROAD rects from the town corner, over floor/outside, not wall/river/footprint). Only the six kit pieces exist (no house art), so character is placement, town size (Gullstrand/Stiltmere 13 wide, Hawkstead 11x11, Hornridge 11x13), gate side (S, N) and streets.

**Why:** PR #914's LPC cutter cuts one footprint+door per style and piece (first town wins, others fall back to procedural) and refuses a `rise` over walkable ground; so footprints/doors stay at auction 3x2 (1,1), smithy 1x2 (0,1), hall 3x2 (1,1), chapel 1x2 (0,1), board 1x1, inn 3x2 (1,0). Rising pieces (auction, smithy, hall rise 1, chapel rise 2) need wall or building behind: north row at y=1, or the chapel stacked under the hall at its edge. worldcheck now checks all of it for the Vale.

**How to apply:**
- Never BRIDGE on land: terrain.js treats BRIDGE as water for shore edges. Use ROAD for causeways and quays.
- A road or ground rect touching a river tile can open a river tile (solid grid shoulders) and fail passablecheck "river water is solid"; Gullstrand's gate faces the river so its Hawkstead road goes via point `northWay`.
- NPC homes are a row along the back wall (npcs.js homeAt); a plan standing buildings there needs `standAt` (added), else pathcheck "nobody stands in a solid tile".
- Terrain painter skips tiles of a footprint but not the door; spots `square` must be an open tile; grave tile is (w-3, 6) from the corner, keep it free.
