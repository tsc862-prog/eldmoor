---
name: roads-knowledge
description: #539 roads line in the turn header, place danger reasons, "You remember" warnings, typical-level worst rating, witness needs sight
metadata:
  type: project
---

brief.roads = roadsLine(a) in lore.js (here, bound-for from a.pq[0] label/ground, then most-hurt known regions; max 3 places, 260 chars, null when empty); runner side `roadsNote` in scripts/pacing.mjs, folded into memoryNote (so local and Claude headers both carry it). placesView gives "danger: <why>" via dangerWhy; move_to/lead_to warnings use placeMemory ("You remember X: ..."); dangerWords/learned still use placeWarn (no prefix). Region "worst you know" rates e.last (set in seenLvl) not e.hi (old saves fall back to hi). witness(): sight range or same raw a.company within WITNESS; never into/out of the Crypt (dead.hidden).

**Why:** owner asked why agents are warned by the game after deciding instead of knowing beforehand. **How to apply:** agent-only (learner), no RNG; hashes (professioncheck, tablecheck) unchanged vs main. Verify hashes against `git archive` of HEAD in the scratchpad, not E:/eldmoor (may differ).
