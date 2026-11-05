---
name: art-post-processing
description: why generated tiles came out striped or blotchy (grid multiples, wrong-subject autotiles) and how post-texture.mjs now handles it; reprocess on a scratch copy with --dir
metadata:
  type: project
---

2026-11-03 run: 9 of 12 tiles rejected. Findings (PR "Art: post-processing for striped and blotchy tiles"):

- Stripes = grid detection, not the crop, dither (default 0) or quantise. Structured raws (bricks, cracks) have edge lines on every 2nd-4th cell, so a multiple of the real 8 px grid (16, 24, 32) scored as high and won the "smallest within 85%" rule; native image was then 32-64 px and nearestScale blew it up. Fix: `fundamental()` in `scripts/art/post-texture.mjs` picks the integer divisor whose score-above-1 is at least 60% of the top's (a true 2g grid gives under 50%, so true 16 grids stay). `post.fundamental:false` keeps the old pick; set on tile:ash-rock so its reprocess stays byte-identical (old pick was y=32).
- Autotiles: the model drew scenes, walls and blotches for "transition tile", not A-over-B pieces. Processing cannot repair that. `pieceStats`/`ShapeError` reject it (kind 'flat', so raw kept and redrawn later); `post.shape:false` skips. Prompts rewritten to "ground texture filling the whole image, upper half X, lower half Y" with scene negatives, seeds 1881-1885.
- Reprocess offline on a copy: `node scripts/art/reprocess.mjs <date> --dir <copy-with-incoming/<date>>` (never write into the owner's assets/). On Windows pass a C:/ style path to node, not /c/ (git-bash path breaks ESM imports).
