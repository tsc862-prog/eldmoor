---
name: valehouses
description: #940 finishing the Vale towns: a north-door cottage row, street cut and curved kerbs, knot-free decking, gable roofs that keep their courses along the ridge, plan limits for Brandhold and Hawkstead
metadata:
  type: project
---
world/vale-houses (2026-11-05), stacked on #949; the owner judges by shots.

- Before placing a house in a Vale plan, dump the plan as ASCII with doors and `c.grave` (x1-1.5, y0+6): the grave tile is (8,6) in an 11-wide town and (10,6) in a 13-wide one, and nothing checks it. Then walk gate to every door with `solidAt`: passablecheck does not prove each door is reached from the gate.
- Two 2x2 houses side by side against a wall leave the west one's door shut in. `house-lane` (door [0,0], north side) is what opens it, through an alley.
- Brandhold could not hold two houses west of the street with the inn at (2,5): the inn moved to (2,4). `ground` stayed as it was, so the Vale tile hash held; a yard tile under a building does no harm.
- A view from the south cannot show a north door: `house-lane` uses the inn's cut roof and steps. A real north face would need a new view.
- LPC Roofs' top-left block (0,0 170x200) is the slate gable: slopes with ticks along the ridge. A slope facing east or west with courses across the view reads as brick.
- The kit's deck board has marks only at both ends, which tiled into a 62 px pattern; decking now puts them at real butt joints (`planks`), patch 12x8.
- Stalls in a plan town: a second, tighter pass in townlife.js. A stall against a building hides its front, so the row behind must stay open; a door above or just below rules out the spot.
- The cutters keep an entry's `accepted` date now; only new entries get today.
- Proof for "Eldmoor and Stepping unchanged": logs/tools/townhash.mjs painted every town through `drawPlaces` in a real page on both trees and hashed the pixels.
- **Why:** the owner wants towns that look lived in, without touching the other worlds.
- **How to apply:** see [[lpchouses]], [[lpcbuildings]], [[previews]]. Long Python in a Bash heredoc breaks on quotes: Write the script. Let the shot script spawn vite as its child, so each run has fresh modules.
