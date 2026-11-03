---
name: talk-setting
description: #431 talk scenes open on a room by where the townsperson stands (roomFor in talkscene.js); smithy and gate settings; field keeps the cut
metadata:
  type: project
---

A talk Table scene (#407) sets ctx.setting and ctx.town via `roomFor(p)` in src/sim/talkscene.js: the nearest town spot to the person maps inn->tavern, chapel->chapel, smith->smithy, gate->gate, quartermaster->cellar, square->tavern. A person outside every town rect gets no setting, so the scene view keeps the terrain cut.

**Why:** sceneview.js treats kind `talk` as indoor only when ctx.setting is a real row (no town-pad fallback), so a field talk near a town edge stays outdoors. Settings smithy and gate were added to data/settings.js (theme rows in render/palette.js) with no `words`, so existing word-based picks and stage_scene fits did not move.

**How to apply:** a new talk reason needs nothing; a new town building needs a ROOM entry. Hashes unchanged (ctx only on agent talks). Tests: tablecheck --talk (room cases), uismoke scene maps (talk in town, gate, field).
