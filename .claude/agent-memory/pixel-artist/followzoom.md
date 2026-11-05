---
name: follow-zoom
description: #846 follow view width scaling (followTiles in tile.js, art-snapped) and crawl camera half steps; staging with shoot.mjs --crawl
metadata:
  type: project
---
- Follow view tiles across = followTiles(canvas px): 29 up to 1400 px, 40 from 2350 (the map pane at 3440), then snapped to whole art pixels (`snapArt` in draw.js, ART px a unit) so about 42 tiles at 3440.
- Crawl camera (`frameOf` in interior.js): half-unit steps from 2 up (whole 2x art), margin r.h+3.6, and the lit room before is framed too when the pane is wide enough.
- `node scripts/shoot.mjs <url> <out> --crawl` gives follow and crawl shots at 3440 on your own vite (scratch config, cacheDir in temp). Check the port is free first: 5902 was taken by someone else.
