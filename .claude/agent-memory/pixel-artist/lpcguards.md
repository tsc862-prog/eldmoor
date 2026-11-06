---
name: lpcguards
description: #830 guards, stallkeepers, critters in LPC: where each animal came from, which LPC animals are refused by licence, staging and shot traps
metadata:
  type: project
---
Branch render/lpc-guards (2026-11-05), stacked on #854.

- Guards: role `guard` is `renderOnly` in lpc-townsfolk.json, never in data/npcs.js. 64x64 frames so the spear is not clipped; LPC walk carries a spear level, so the stand pose comes from the thrust's last frame (rows 6 and 4, col 3: `frame.stand`). Halberd is level too and worse. Upright is only available front and back, so posted guards always face down.
- LPC animals by licence (OpenGameArt pages read 2026-11-05): fine: cats and dogs, rabbit (Redshrike), [LPC] Birds, Evert's ram. CC-BY or GPL only, so refused under "CC0, OGA-BY, CC-BY-SA only": LPC farm animals chicken, chicken rework, [LPC] Goat, [LPC] deer. Stand-ins: Shepardskin chicken (CC0, GIF sheet, 12 px, one art pixel outline added), ScratchIO deer (CC0, side view only), ram as goat. If the owner allows CC-BY the real ones fit better.
- A CREDITS.csv row can have unquoted commas in notes (weapon/polearm/spear): `creditsFor` now finds the licence column.

**Why:** the next person will otherwise redo the search or re-try the halberd.
**How to apply:** new animals go in lpc-critters.json (`npm run art:lpc-critters`); sheets are index-only.

Staging traps:
- To see wall art not in your base: `git merge-tree --write-tree HEAD <branch>`, `git archive <tree> | tar -x` into logs/tmp. An index.json conflict leaves markers in that tree: rebuild it as a union of both sides.
- A scratch vite that ignores `**/logs/**` will not notice index.json edits under logs/tmp: restart it, or the "sheets removed" fallback shot silently shows the sheets.
- Long Bash heredocs with quotes fail or hang; a bare `cat > /dev/null` hangs. Use Write. In Python heredocs use raw strings for regex, `\\b` came out as a backspace.
- Eldmoor's towns sit at the map's west edge, the camera clamps, so crops need an x offset (ox about -470 for the gate). `Page.captureScreenshot` clips past the left edge show the wrong part of the page.
