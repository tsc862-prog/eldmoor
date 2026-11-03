---
name: art-pipeline
description: #177 art pipeline - HF Inference Providers request shapes (fal-ai LoRA body, confirmed live), credits ($2/month PRO, ~$0.01/image), texture-preserving post-processing, raw/reprocess, daily/accept protocol, pitfalls
metadata:
  type: project
---

#177 (2026-11-02/03): `scripts/art/` generates PNG assets offline via Hugging Face Inference Providers; HF_TOKEN only in gen.mjs (portraits are a pre-generated library, so the relay needs no HF provider).

**Why:** owner lifted "no image assets"; procedural renderer stays as fallback for every id. Owner wants the allowance used every day and never to spend money.

**How to apply:**
- Request shape CONFIRMED by the first real run (2026-11-03, owner-approved, 5 calls): `POST https://router.huggingface.co/fal-ai/fal-ai/fast-sdxl` with `{prompt, negative_prompt, image_size:{width,height}, num_inference_steps, guidance_scale, seed, num_images, sync_mode:true, output_format/format:'png', loras:[{path:'https://huggingface.co/<repo>/resolve/main/<file>', scale}]}` -> PNG decoded fine. Mapping from public `GET https://huggingface.co/api/models/<repo>?expand[]=inferenceProviderMapping`. pixel-xl (nerijs/pixel-art-xl) answered first.
- Credits (HF pricing docs, read 2026-11-03): free accounts get NO Inference Providers credits; PRO $2.00/month; beyond that pay-as-you-go if a payment method exists. So a "run until 402" day could spend money: daily.mjs now stops at monthlyUsd/days-in-month (ART_DAILY_BUDGET) and at the month's total, summed back from art.log `est. $X` fields. ~$0.01/image is our estimate (costPerImage), not a measured price: about 6 images a day, ~200 a month.
- First real tiles were flat (1-2 colours) because the whole 1024 image was area-voted to 16 px. Fix (post-texture.mjs): detect the model grid (edge energy per column, period 3..32 in 0.25 steps, smallest within 85% of best; pixel-xl ~8 px), sample the middle half of each cell (~127 px native), seamless crop (wrap-match cost) 1 model px = 1 game px, tone match (per-channel mean/std, stretch cap 4x) then quantise to the palette widened to 6+ shades, optional Bayer dither; reject < minColors (4 for tiles) as flat. Base tiles are now 32x32 patches.
- Raw images are saved before post-processing: assets/incoming/<date>/raw/<kind>/<name>[.altK].png + raw/index.json (model, seed); `npm run art:reprocess -- <date>|all [keys]` re-runs offline. The 5 first-run tiles have no raw (they predate this): reject them and redraw.
- Stop rules (gen.mjs classify): 402 = quota; 429 quota text or retry-after>120 = quota, else retry then 'rate'; 403 quota text = quota else auth; 400/404/422 = model -> next candidate while nothing pinned; x-ratelimit-remaining 0 = stop. Failed/flat draws retry with seed + tries*104729; rejected ones with seed + n*7919.
- State: assets/queue.json + assets/incoming/ gitignored. art.log line: `<date> HH:MM | made N | rejected N | calls N | est. $X (month $Y of $2.00 credits) | model | stop | next`.
- Pitfalls: the Bash tool eats backslashes even inside quoted heredocs (regexes, `\n`, `\\`), which broke up.mjs, sheet.mjs, daily.mjs and a CLAUDE.md path. Write patch scripts with the Write tool, and use `s.replace(a,()=>b)` because `$` patterns in replacement strings bite. Never spawnSync a child that talks to an in-process mock server. `npm run sim` is unseeded; compare `node scripts/professioncheck.mjs --hash` against a `git archive origin/main` extract instead.
- Related: [[agent-player]], [[brain-design]].
