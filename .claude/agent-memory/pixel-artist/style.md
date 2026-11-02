---
name: Art style and palette decisions
description: The shared palette module, UI colour contract, biome-keyed art, and the style rules from docs/ART-PLAN.md
type: project
---
- `src/render/palette.js` is the one place for render colours: `UI` (must equal style.css --gold/--blue/--red/
  --amber/--green/--ink/--dim), `DISPO` hostile red / neutral amber / friendly green, `ROLE` + `ROLE_LIGHT`,
  `classColor(cls)=CLS[cls].acc` (the UI's classColor must agree; ui-designer owns the UI side), `TEXT`,
  `MARK`, `LIGHT`, `BIOME` ground/forest per biome, `biomeOfZone(z)`.
- Key art by `REGIONS[z].biome`, never by zone index (the Stepping Lands reorder zones: 3 is ash, 4-5 tundra).
  Landmarks: loop `LANDMARKS` (several crypts exist), never assume one `CRYPT` for drawing.
- Style: light from the top left; 1px dark outline on entity sprites only; ground in mid values, entities and
  marks own the extremes; labels never overlap (priority wins).
- FAC colours equal the tank/DPS role colours (blue/red). FAC is character-builder's; flagged in ART-PLAN.
- PR order for #176: palette -> terrain -> sprites -> labels -> lighting -> minimap, stacked branches render/*.
- Portraits (#367): `src/render/portrait.js`, 15x18 faces shown at 2x in the party frames (`.pfport` is 30x36
  content-box). Seeded by core/rng `hash()` of id+name (ids are reused by New World), never `rnd()`.
  `portraitPixels(a,mode)` is DOM-free so Node can check determinism; modes '', 'dead' (grey), 'ghost' (blue).
