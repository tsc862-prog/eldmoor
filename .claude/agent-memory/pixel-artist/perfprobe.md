---
name: perfprobe
description: #716 browser frame-time probe (npm run perfprobe), how to A/B render changes against main, what the 2026-11-03 numbers showed and what was fixed
metadata:
  type: project
---
`npm run perfprobe` (scripts/perfprobe.mjs, #716, epic #31's 60 fps done-when) starts its own Vite (5901, base on 5902),
headless Chrome at 3440x1440, seeded worlds (`--seed 716`), Stepping topped up to 100 heroes; prints frame/work
p50/p95 and a phase split from `globalThis.__drawPhases` (a timer inside draw.js `draw()`; keep the `ph(i)` marks
when editing draw.js).

**Why:** the owner's box (RTX 4090, Ollama) is noisy: the same config moved 2x between runs minutes apart, and the
headless vsync read 17.9 ms in one session and 16.7 in another. Cross-run comparisons are worthless.

**How to apply:**
- A/B only with `--base <dir>` in one process: `git archive origin/main | tar -x -C <scratch>/base`, and copy a draw.js
  that has the phase timer into it if the base lacks one. Use `--speeds 0` for render-only comparisons (frozen, identical
  seeded world on both sides).
- Findings 2026-11-03: whole-map terrain cost ~2 ms a frame in drawImage (a GPU flush inside the chunk draws, not the
  chunk size; half-res chunks did not help) -> still-camera cache of the terrain at screen size (draw.js `drawTerrain`,
  keyed on view + `terrain.js` `chunkGen`). Entities ~4.5 ms for ~350 at whole map -> shadows in one path, no
  save/restore per mirrored sprite, heroSprite per-hero cache, memoised sheet ids. Frozen whole map 3.4 -> 1.3 ms p50.
- What is left: entity pass ~1-2 ms at whole map (scales with entity count) and the sim at 8x (updAgent, updMob,
  stats.js sameKey, spatial rebuild), which is not render's to fix. See [[previews]] for driving Chrome.
