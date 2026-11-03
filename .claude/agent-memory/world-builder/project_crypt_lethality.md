---
name: crypt-lethality
description: #269 crawl room hit values x2.25 for about 0.6 Fellowship Crypt deaths per 120-min run
metadata:
  type: project
---

CRYPT.rooms[].hit in src/world/spec.js (both worlds) multiplied by 2.25 (rounded: .225 .29 .38 .43; Stepping .27 .36). Owner chose "real" on #269.

**Why:** hardcore stakes; deaths come as single members falling, wipes stay 0 by design.
**How to apply:** 10-seed result: Crypt deaths 0.0 -> 0.6, clears 15.4 -> 10.5, driven back 3.4 -> 6.4, level -0.3 at 120. 2.0x gave 0.2, 2.5x gave 1.1. Map hash does not move (rooms are not tiles). Tune only `hit`, not `hits`.
