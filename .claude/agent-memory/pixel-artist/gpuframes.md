---
name: gpuframes
description: "#979 final: frame rate on the real GPU (not --disable-gpu), the chunk stalls that were the true problem, how to stage a setup world for a probe"
metadata:
  type: project
---
Headless Chrome with `--use-angle=d3d11 --enable-gpu-rasterization --ignore-gpu-blocklist` uses the RTX (check chrome://gpu or WebGL's renderer string). The cinema view then runs at 2-5 ms of script a frame; `--disable-gpu-vsync --disable-frame-rate-limit` shows 220-240 fps. The ~10 fps of `--disable-gpu` runs was the software canvas, not the game.

**Why:** rAF on this box ticks at 18.0 ms headed and headless, so a capped run cannot show headroom; only the uncapped run can.

**How to apply:**
- Judge a render change by stalls first (frames over 30 ms from Start, `max`), then by work p95. p50 sits on the vsync clock whatever you do.
- A setup world reaches session zero's indoor scene after Start anyway: `draw()` returns early and phases read 0. To measure the map: `TABLE.mode='off'`, `S.table=S.tables=null`, `S.opening.queue=[]`.
- Staging heroes outside a town: set `state='fight'`, `target=m`, beside the mob; `state='town'` outdoors just stands there.
- At speed 0 the director is still and water, wheat and crowns go on: use it for motion frames and a heatmap of frame differences.
- Chunks: `terrain.js` `warmChunks` paints a row of tiles per idle slice; `assets.js` `worldArt` loads art before the first paint. A new terrain cost must stay row-sliceable. See [[perfprobe]], [[previews]].
