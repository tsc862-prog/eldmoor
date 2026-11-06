---
name: showcaselight
description: "#979 light pass: grade.js, shadows.js, lightmap.js, atmos.js, sheen.js, quality.js; what looked wrong first, how to stage and measure at full window"
metadata:
  type: project
---
The world's light since #979: `grade.js` (hour table, sun path), `shadows.js` (cast shadows swept from caster masks, figure silhouettes), `lightmap.js` (one quarter-res multiply: ambient, canopy shade, vignette, lights), `atmos.js` (mist, haze, fog on one sixth-res canvas under the light map), `sheen.js` (sky colour on water), `quality.js` (FX.full, Settings "Effects", `?fx=lean`).

**Why these choices:** a multiply map instead of a blue wash plus `lighter` glows is what makes a fire light people and ground. Gold over blue water reads grey, and a warm `color` blend reads as a dirt road, so sheen uses a `color` blend toward strong blue that the warm light brings down to slate. The sun runs right, top, left so shadows always fall down the screen; a shadow falling up hides behind the art. Cast shadows are cut off crowns and roofs because `drawTree` redraws a tree in front of entities without them; depth in woods comes from the light map instead, which covers everything.

**How to apply:**
- A light source calls `glow(x,y,r,rgb,a,flat)` from `lightPass`; `flat` means ground only, no bloom. Keep colours as constants: stamps cache by colour.
- Blur a mask with ONE filtered drawImage after plain fills. A canvas `filter` set while filling tiles blurs each rect alone: slow, and a thin river's mask comes out weak.
- Staging at the cinema size: CSS `#screen{position:fixed;inset:0;width:100vw;height:100vh}` before measuring; the normal pane is 43% of the pixels, so full-window numbers are the worst case. Copy perfprobe with that CSS for an A/B ([[perfprobe]]).
- Shots need a wait: LPC walls and buildings arrive after the first paint, so a too-early "before" shows the old walls. See [[previews]].
- `rm -rf` on a scratch folder is refused by the permission layer: write to a new folder instead.

Motion (#979): `water.js` (flow from a walk along the river tiles, glints, foam, wading rings; in a scenery world marks follow `waterLevel`, the painted edge, not the tiles), `sway.js` (one `gust` field; crowns are copies sheared over the chunk art, blades, wheat from `ACTIVE_SPEC.scenery.fields`), `motes.js` (stateless, kind by the biome under the mote), cloud shadows in `lightmap.js`. Warm tints on water read as a dirt road: `sheen.js` pushes it blue instead. There is no ffmpeg on the box; an APNG can be packed from PNGs by rewrapping IDAT chunks.
