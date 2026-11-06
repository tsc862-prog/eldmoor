---
name: project-vale-world
description: Third world the Wending Vale (id vale, epic #940 slice A): geography, ladder rule in worldcheck, gotchas
metadata:
  type: project
---

`VALE` in spec.js (`?world=vale`, `ELDMOOR_WORLD=vale`), 144x60, non-default. East-west river the Wend (curve axis 'x', sin only, so crossings are named by row in `points`), `river.span [0,121]` (new gen.js option: painted only for those columns, so it can rise in a spring), one ford (x=76), two bridges from routed roads via bank points. Six regions by x (Wendmouth 1-5, Sallowfen 3-8 south, Greywood 6-11, Hawkwold 3-8 north, Ashenfold 10-15, Rimecrown 14+), six towns (all peoples), four spec dungeons (rooms + `entry`, forward compatible with #902), lair at x134.

**Why:** owner epic #940; #934 lesson: no region next to a start may be far above it. Spec flag `ladder:{step:4}` makes worldcheck test every town's neighbouring regions (and proves the test catches a doctored world).

**How to apply:**
- Region order matters to tests: prologuecheck picks ZONES[2] as a seasoned start, so index 2 must have low band above 3 (Greywood, hence Hawkwold listed after it).
- A road must not end on a lair centre (it paints ROAD over the nest rock and fails passablecheck); end it at a point outside the ring.
- Fauna rows for the Vale live in data/fauna.js (first pass, stock species); creature-designer refines in slice D. Six first-delve rows appended in prologues.js via the `valeDelve` helper.
- Vale snapshot hashes in worldcheck.mjs; Eldmoor and Stepping hashes must not move.
- pathcheck on all three worlds takes about 3 minutes: run it in the background.
