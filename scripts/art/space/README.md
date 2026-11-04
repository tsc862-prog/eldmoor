---
title: Eldmoor Art
colorFrom: gray
colorTo: green
sdk: gradio
sdk_version: 6.30.0
python_version: "3.12"
app_file: app.py
suggested_hardware: zero-a10g
pinned: false
license: other
short_description: Eldmoor pixel-art generator (SDXL + LoRA, ZeroGPU)
tags:
  - zerogpu
  - pixel-art
---

# Eldmoor art (private ZeroGPU Space)

The generator behind Eldmoor's image assets (issue #703). SDXL base with the manifest's pixel-art LoRAs
(`loras.json`, written from `scripts/art/manifest.json`), two API functions:

`generate(prompt, negative, seed, steps, guidance, width, height, lora_scale, lora_repo) -> (PNG, GPU seconds)`

`img2img(prompt, negative, seed, steps, guidance, init_png, strength, lora_scale, lora_repo) -> (PNG, GPU seconds)`

`img2img` (issue #763) starts from the game's own procedural art (`init_png`: a PNG in base64, its size is the image's size):
buildings, landmarks and sprites keep the game's view and silhouette, and the model adds texture.

`scripts/art/daily.mjs` and `gen.mjs` call it through Gradio's HTTP API (`/gradio_api/call/generate`) with the same
prompts, seeds and settings as before; images draw on the owner's daily ZeroGPU quota (PRO: 40 minutes a day), never on
Inference Providers credits.

## Setup (once)

1. Make a fine-grained token on https://huggingface.co/settings/tokens with **write** access to the one repo
   `spaces/tsc862/eldmoor-art` (and read access to it). Put it in the game's `.env` as `HF_SPACE_TOKEN` (or as
   `HF_TOKEN` if that one token should do everything). Leave every billing or "Inference Providers" permission off on a
   Space-only token: ZeroGPU use past the daily quota can be billed to credits only when the token allows it.
2. `npm run art:space -- --push` creates the Space (private, Gradio SDK), uploads these files and asks for ZeroGPU
   hardware. If the hardware request is refused, choose **ZeroGPU** under the Space's Settings once.
3. `npm run art:daily -- --now` makes the first images. The first call after the Space slept waits for it to load (1-3 minutes).

The token is read only by `scripts/art/*.mjs`, never printed and never sent anywhere but huggingface.co and the Space.
