---
name: lpcwalls
description: #830 town walls, towers, gate piers, plaza and shadows cut from the LPC castle kit; timber shakes from LPC Roofs; staging trap with vite after edits
metadata:
  type: project
---
#830 (render/lpc-walls, 2026-11-05), stacked on #914; the owner judges it by shots.

- Set per style in `scripts/art/packcut-walls.mjs`: one cut per wall side, never turned (top-down faces and light go wrong). Towers and piers have no side, so they need no turning. `townart.js` draws the set only when whole (`wallSet`).
- All art stays in the ring: a tower is two ring tiles, the tall pier stands on the ring north of an E/W gate. In a 9-tall town the south pier has one tile because the corner tower takes the next: that is why the piers differ.
- LPC Roofs (OGA, CC-BY-SA 3.0/GPL, `lpc-roofs` set) has wood shakes, slate, ceramic, shingles and scallops: the first place to look for any roof. Its `roofs.png` is 2048 square; shake courses at 320,1032, 96x24.
- Kit wall tops are one flat dark colour; flagstones on walks and radial merlons on towers both read as noise at 32 px. Flat walk plus cross joints, few wide merlons.
- `TOWN_GROUND` is its own table because the manifest quantises to everything under `TOWN.<style>`.
- **Why:** owner wants the LPC look through the towns, and the plain procedural ring looked weak beside #833's buildings.
- **How to apply:** a change to the set: edit the cutter, `npm run art:lpc-walls`; artcheck reads the index and the side rule.
- Staging: `setZoom` silently does nothing after any file edit until your vite restarts (see [[previews]]); a town at follow scale in `setView('map')` is zoom 3.4 on Eldmoor, 6.8 on the Stepping Lands. `setView('follow')` picks its own hero, so stage towns from map view. See [[lpcbuildings]], [[towns]].
