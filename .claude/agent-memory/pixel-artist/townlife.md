---
name: townlife
description: #795 town life modules (life/critters/townlife/footprints), the deco-entity hook in draw.js, staging shots and a heredoc gotcha
metadata:
  type: project
---
- Ambient life is render-only: `life.js` frame facts + private `lrand`; `draw.js` takes `kind:'deco'` objects (with `paint`) in the y-sorted list. Cost via `lifeStats.ms` (0.1-0.3 ms).
- Buildings smithy/chapel/inn/board had no procedural art; townart now draws `pieceart.sketchPiece` for them (chimney spots: smithy +12,+1, inn +38,+1 from the draw box).
- Stage shots: scratch vite config with `root` the worktree and own cacheDir; Node CDP script spawning Chrome; `pre` JS sets `S.gameMin` hour, `setZoom`, `cam.camX/camY`; for snow prints place an agent on SNOW and tick `a.x`/`a.moving`.
- The Bash tool choked on one large heredoc containing JS with quotes (exit 2, nothing written); use the Write tool for big files.
