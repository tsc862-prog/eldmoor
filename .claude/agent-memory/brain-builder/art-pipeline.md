---
name: art-pipeline
description: #177 slice 1 art pipeline - HF Inference Providers request shapes (fal-ai LoRA body), candidate models, quota stop rules, daily/accept protocol, artcheck mock pitfalls
metadata:
  type: project
---

#177 slice 1 (2026-11-02/03): `scripts/art/` generates PNG assets offline via Hugging Face Inference Providers; the owner wants the FREE allowance used daily and never any spend; HF_TOKEN only in gen.mjs (owner decided portraits are a pre-generated library, so the relay needs no HF provider).

**Why:** owner lifted "no image assets"; procedural renderer stays as fallback for every id.

**How to apply:**
- Request shapes (verified only against docs + Hub mapping, NOT a real call as of the PR): mapping from public `GET https://huggingface.co/api/models/<repo>?expand[]=inferenceProviderMapping` (providerId, adapter 'lora', adapterWeightsPath). fal-ai route: `POST https://router.huggingface.co/fal-ai/<providerId>` body `{prompt, negative_prompt, image_size:{width,height}, num_inference_steps, guidance_scale, seed, num_images, sync_mode:true, output_format/format:'png', loras:[{path:'https://huggingface.co/<repo>/resolve/main/<file>', scale}]}` -> JSON images[0].url (data: or https). hf-inference: `{inputs, parameters}` -> raw bytes. If the first real run fails on body shape, look here first.
- All 5 candidates map to fal-ai only (2026-11-02): nerijs/pixel-art-xl and artificialguybr/PixelArtRedmond (fal-ai/fast-sdxl), UmeAiRT FLUX LoRA (fal-ai/flux-lora), tarn59 z-image turbo LoRA, FLUX.1-schnell base. JPEG answers are refused (zero-dep PNG codec only); we ask format png.
- Stop rules (classify in gen.mjs): 402 = quota; 429 quota/credit/daily/monthly text or retry-after>120 = quota, else short retry then 'rate'; 403 with quota text = quota else auth; 400/404/422 = model -> next candidate (only while nothing pinned); x-ratelimit-remaining 0 = stop after that call. Cost counts successful images only; log always says "$0 billed".
- State: assets/queue.json (gitignored: model.pinned/tried, incoming, failed{tries}, rejected{n} -> seed+7919n, alts) and assets/incoming/<date>/ (gitignored). Alternate keys `id#altK`, files `<name>.altK.png`, seed+1000K. art.log line starts with the RUN date (`--date`), and "already ran today" only for stops that will not change (allowance/rate headers/ART_MAX_CALLS/complete).
- Browser: main.js import.meta.glob of assets/index.json + assets/*/*.png (?url eager) -> provideAssets; render/assets.js asset()/assetPixels() null until loaded; terrain.js texel() hook via ASSET_TILES (samples by world pixel mod w,h) and onAssets clears the chunk cache. ASSET_LATER = road/water/transitions generated but not drawn until slice 2.
- Pitfalls: heredocs with JS regex/`\n` inside python/node -e mangled files twice (up.mjs, sheet.mjs) - use Edit for code containing backslashes. Never spawnSync a child that must talk to an in-process mock server (event loop blocks); artcheck uses async spawn. `npm run sim` is unseeded, so compare `node scripts/professioncheck.mjs --hash` instead.
- Related: [[agent-player]], [[brain-design]].
