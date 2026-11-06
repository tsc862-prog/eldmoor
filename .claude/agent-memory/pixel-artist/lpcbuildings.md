---
name: lpcbuildings
description: #833 town buildings cut from the LPC kits: ids, rise rule, what the kit gave, the north-door inn, staging traps (shared Vite ports)
metadata:
  type: project
---
#833 (render/lpc-buildings, 2026-11-05). Waits on the owner's yes on the buildings direction; he judges the PR by shots.

- `scripts/art/packcut-buildings.mjs` lays each piece up from parts at LPC's own scale; `building:lpc-<style>-<piece>` have no manifest row (the `!e&&a.source` branch of checkIndex), so the generated slots and their footprint checks stay as they were.
- The LPC door is 32x48, so a 2-tile-tall footprint cannot hold wall + door + roof. The north row rises one tile over the town wall; a piece may never rise over walkable ground, because terrain art cannot hide an entity. To go taller elsewhere, buildings would need an overlay in the y-sorted entity list.
- The plan's inn door is on the north (street) side, which the view cannot see: the roof is cut for steps down to a lintel. A south-side plan door would need a sim/plan change, and that moves hashes.
- Best parts: slate panel inside its frame (roof), castle_outside ashlar, bridges deck boards, signs.png plaques. The kit's "chimney" and tall window did not work; one pane plus the far frame fits between door and corner.
- **Why:** per-piece images are per style, so a town with another gate side (door on a side wall) falls back to procedural through `foot`/`door` on the index entry.
- **How to apply:** new piece or shape: a recipe in RECIPES, re-run `npm run art:lpc-buildings`; artcheck reads the committed index against both worlds' plans.
- Staging trap: Vite ports 5902-5910 are shared with other agents. A strictPort failure plus a successful fetch means you shoot THEIR worktree (big trees that were not ours gave it away). Test the port is free first and take the "before" from your own tree with the pieces removed. See [[previews]], [[towns]], [[freepacks]].
