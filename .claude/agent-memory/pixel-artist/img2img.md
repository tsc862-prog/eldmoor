---
name: img2img
description: #763 owner decision: buildings, landmarks, sprites made image to image from procedural art; init layout contract, what real Gradio does, how to test the Space app locally
metadata:
  type: project
---
Owner (2026-11-03, #763): buildings, landmarks and sprites start from the game's own art at low strength; text-only stays for
tiles, props, portraits, backdrops. **Why:** pixel-xl ignores layout prompts (4 of 96 passed, and those looked awful in game).
**How to apply:** tune `kindInit` strengths after the first real batch (drift/spill limits in post-init `INIT_GATE` are guesses:
mock answers only, no real image has been through them yet). The reject gate and art:preview still apply.

- Contract: init art at asset size -> one whole scale k, centred on the model's canvas, on white; post reads cell k x k back as one
  asset pixel and keeps the art's alpha. So heroes (10x12 strings) sit at x3 by y4 in a 32x48 frame (slimmer than the procedural
  x4 sprite, same height); creature frames are exactly strings x4, figures touch frame edges, so the outline is per frame
  (rimFrames) and post-sheet's run-finding layout check cannot be used; drift per frame replaces it.
- Creatures have no front or back view: rows down/right are the side view, left/up mirrored. Heroes' side/back are face moves in init.mjs.
- Real Gradio 6.30 facts (ran app.py with stub torch/diffusers/spaces, gradio pip-installed with --target into the scratchpad,
  GRADIO_SERVER_PORT, and space.mjs against it): an unknown api_name answers bare HTTP 500, not 404; files over this API are URLs only,
  so the init goes as base64 in a Textbox; the file result, error events and named endpoints behave as the mock does.
- Staging fixture answers in game: Node runs initArt -> initCanvas -> img2imgArt -> processRaw, page gets base64 PNGs and
  setAssetPixels; Vite via a scratch config with cacheDir in the scratchpad. See [[buildingrecipe]], [[spritesheets]], [[artreview]].
