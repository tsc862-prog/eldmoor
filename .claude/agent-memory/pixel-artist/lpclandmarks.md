---
name: lpclandmarks
description: #836 crypt mouth and lair in the LPC look - what LPC pieces were used, staging recipe for landmark shots, disk and port gotchas
metadata:
  type: project
---
#836 (branch render/lpc-landmarks, PR 878, 2026-11-04). `scripts/art/landmarkcut.mjs` cuts `landmark:crypt-mouth` (96x96) from
castlewalls.png (Daniel Armstrong: arch + brick course, recoloured onto FLAT.crypt greys) and `landmark:lair` (256x256) from
lavarock.png (Sharm: plain charcoal tiles, ragged noisy-disc edge, ember cracks, gold heap hand-set). No scaling.

- The lair asset covers the 8x8 inner disc inside the lava ring (the ring stays procedural); the procedural lair draws nothing, so the
  LPC nest is a clear gain. The crypt: LPC arch beat procedural only narrowly; the .85 img2img candidate has the skull character but is a
  flat sticker. Owner chooses; swap is the one PNG.
- Staging a landmark shot: follow view, teleport three heroes beside it (`a.x/a.y`, state town), `C.select`, set `cam.camX/Y`,
  `setAssetPixels(id, pixelsOf(w,h,data))` from a base64 PNG, clip screenshot to `#screen`, wait 16 s after `?continue=1` (9 s left
  S.agents empty once).
- C: drive can be full (ENOSPC fails artcheck): set TEMP/TMP to a folder on E: for the checks. Ports 5902, 5906, 5907, 5909 were
  taken by other agents; check with curl/netstat before binding.
- `cat > file` with no heredoc hangs the Bash tool (again): write scripts with a heredoc to a .cjs and run them.
