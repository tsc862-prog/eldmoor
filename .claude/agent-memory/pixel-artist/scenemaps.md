---
name: scene-maps
description: #431 scene maps design (outdoor = real-world camera cut, indoor = generated settings), the slice plan, and how to stage scene screenshots
metadata:
  type: project
---
- Owner decision (2026-11-03, issue #431 comment): outdoor Table scenes are a zoomed-in cut of the REAL overworld
  (members and foes where they stand, weather, night, glyphs, spell fx); a generated biome arena is only the fallback
  past the map edge. Indoor settings (house, tavern, chapel, cellar, cell, shrine, hold) are generated rooms.
- **Why:** the owner wants scene maps to match the landscape where they happen; reusing draw.js keeps every world layer.
- **How to apply:** the outdoor mode is not a second renderer: draw.js takes its camera from sceneview.sceneCut()
  (no clampCam, arena pattern past the edge) and adds rings/chevron/speaker/frame. Indoor rooms come from
  data/settings.js -> world/interior.js buildSetting(id, town|sceneId) -> render/interior.js drawSetting, furniture in
  render/furniture.js. Slice 2 (brain-builder/ai-designer) adds stage_scene `setting`; pickSetting already honours
  sc.ctx.setting. Slice 3 is camp/interrogation mechanics (sim side).
- Staging shots: set S.table by hand (unique id each time, or sceneTick will not reopen), ctl.speed=0, a fake wanderer
  pushed to S.wanderers for an indoor cast, then sv.sceneTick({view:'fellow'}). Eldmoor's tundra is a thin strip: a
  deep-snow spot search needs a small radius. Phone: #screen is 640/400 so the banner hides the map; .screen.scopen
  gets a taller height under 600px. See [[previews]], [[dungeon-view]].
- Never put a `// comment` mid-line in a sed/python edit of minified-style lines: it ate a statement twice now.
