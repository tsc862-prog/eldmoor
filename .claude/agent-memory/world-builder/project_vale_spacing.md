---
name: vale-spacing-measure
description: #979/#1000 Vale widened 144->184 so towns stand apart; river warp, north/south region edges, save refusal by map rev, spawn pad
metadata:
  type: project
---

Vale is 184x60 (spec.rev 1). 40 columns inserted near x=41: river curve `warp:{at:41,by:40}` (smooth seam, crossings keep shape), east features +40, Gullstrand +40, Hawkstead +40, Stiltmere +13, Hornridge +27. Region edges: `wEdgeN` (Hawkwold west) and `mEdgeN` (north Greywood/Hawkwold edge, 10 east of `mEdge`) so the north bank has room; towns' gates stay in their old regions.

**Why:** a 144x60 Vale could not separate towns: Aldermere+Gullstrand filled the north bank, bands pinned towns to x<75. Strict "no neighbour in a 54x23 frame" still fails for Aldermere/Gullstrand (11 tiles apart, a sliver).

**How to apply:** east terrain is regenerated, not copied (biome noise is by x,y), so outposts/dungeon mouths may land on rock: check worldcheck's main-land test after moving. Vale crowding fix is data only: spawn.townPad [8,8] and fauna wendmouth roadMinX 999; a pad of 12 empties Hawkwold. Saves with another `mapRev` are refused (`mapStale`, title shows no Continue, boot keeps a `.earlier-map` copy). Bump `rev` whenever a world's map is recut. Unseeded mob-death numbers are noisy; S.fallen caps at 15.
