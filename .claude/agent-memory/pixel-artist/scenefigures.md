---
name: scene-figures
description: #862 sceneFigure/sceneCreature/drawFigure in sprites.js give room views the LPC sheet frame else procedural; portrait head crop hook; staging scripts
metadata:
  type: project
---
- `sceneFigure(e,face,col,k=SCENE_K .75,ghost)` returns ONE shared object (img, src rect, dw/dh, ox/oy from the feet, w/h body, mirror). Sheet frame = 32x48 art px drawn at .75 (12x18 units), faces via the left/right rows (no mirror); procedural keeps its outlined canvas and mirrors. Use w/h for shadows, rings, plates, bars.
- `sceneCreature(type,...)` is sheet-only (null = keep the view's own foe art: crawl rimmed foes, raid adds). Townsfolk/creature sheets just work through `sheetFrame` when #853/#854 land. encounters.js bandits/pilgrim are not heroes or MOBS, left alone.
- portrait.js: `setHeadSource` hook (sprites.js registers it, Node stays import-free); living faces crop 15x18 from the front frame under a faction-tinted backdrop; cache key gains `|sheet`.
- Staging: probe `stageCrawl`, `openScene('opening',...,{setting:'tavern'})`, raid via raidview `lairs()` + a.raid/raidIdx. Driver: node spawns Chrome itself, vite config as plain object with cacheDir in scratch.
