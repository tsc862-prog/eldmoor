---
name: dungeon-view
description: #85 dungeon view design (interior generator, overlay in #screen, last-run tracking) and how to stage a mid-crawl screenshot
metadata:
  type: project
---
- Owner decision (2026-11-02): the overworld stays one seamless map; dungeons, caves and raid arenas are separate
  interior maps behind doors. Slice 1 (Sunken Crypt only) = world/interior.js generator + render/interior.js art +
  render/dungeonview.js overlay. Later slices: foes with HP, room hover detail, history, raids, minimap marker.
- **Why:** the sim clears CRYPT.group the step a crawl ends and keeps only totals (S.fellowship.crawl), so the view
  tracks the last crawl it saw itself (trackCrawl, every frame from draw.js) and diffs the totals for the outcome.
- **How to apply:** interiors are seeded by core/rng hash of the site's name and position plus a local mulberry32, never
  rnd(), so they need no saving. The overlay lives inside #screen after #cv (Table banner and alerts stay on top);
  any element with `data-dungeon` opens it (hero card View inside, Table banner crawl button).
- Stage a shot: ctl.speed=0, then `CRYPT.group={phase:'inside',name,mem:<fellows>,tSite:true,crawl:{i,rd,gap:0,foes:[{hp}],end:null}}`
  and `openDungeon(CRYPT)`; inject a style hiding `.rgate,.ralert` (the run gate re-shows itself). Viewport taller than
  #screen's bottom or use captureBeyondViewport, else the bar is cut. See [[previews]].
