---
name: art-zerogpu-space
description: #703 art on a private ZeroGPU Space - Gradio call protocol, quota/overage facts, GPU-second window and cap, push tool Hub endpoints, pinned versions, test mock, pitfalls
metadata:
  type: project
---

#703 (2026-11-03): art generation defaults to the owner's private ZeroGPU Space `tsc862/eldmoor-art` (source `scripts/art/space/`,
client `scripts/art/space.mjs`, push tool `scripts/art/space-push.mjs` = `npm run art:space`). Router (fal-ai) only with `--provider router`.

**Why:** the $2.00 monthly Inference Providers credit makes ~6 images a day; ZeroGPU PRO quota is 40 min/day separate. Owner: never spend credit without asking.

**How to apply:**
- Quota facts (docs read 2026-11-03, hub/spaces-zerogpu): PRO 40 min/day, resets exactly 24 h after first GPU use; PAST the quota, use is billed to pre-paid credits at $1/10 min (forum: only when the token's permission checkbox allows billing). So the 429 is NOT a safe stop by itself: daily.mjs and gen.mjs stop at `allowance.zeroGpu.stopAtMinutes` 36 counted minutes (ART_GPU_MINUTES). Owner should use a Space-only token (HF_SPACE_TOKEN) with billing permissions off. Not verified live whether the $2 PRO credit counts as "pre-paid" for overage.
- Protocol: POST `<space>/gradio_api/call/generate {data:[prompt,negative,seed,steps,guidance,w,h,lora_scale,lora_repo]}` -> `{event_id}`; GET `.../generate/<id>` SSE: `complete` data `[FileData{url}, gpu_s]` or `error` data message (needs launch(show_error=True)). Bearer token on both and on the file download. Space host `https://<owner>-<name>.hf.space` (dots/underscores -> '-'). Status: GET hub `/api/spaces/<id>` runtime.stage (RUNNING, SLEEPING, APP_STARTING, BUILDING, *_ERROR, PAUSED) + hardware.current; wake = GET space root then poll.
- Quota refusal text parsed for "Try again in H:MM:SS" -> ArtError kind 'gpu' with resetAt; nextCheck('gpu',...,{resetAt}) = that time. Window in assets/queue.json `gpu {start, s, images, resetAt}`; closes at resetAt or start+24h (`gpuWindow`).
- Reserved duration rule shared by app.py `gpu_duration` and `spaceDuration`: min(120, ceil(10 + steps*0.6*px/1M)) = 25 s for 25 steps at 1024. Counted seconds are the Space's measured `gpu_s` (perf_counter inside @spaces.GPU).
- Push: whoami-v2 (role read/write/fineGrained scoped perms `repo.write` for entity user/space), POST /api/repos/create {type:'space',name,private,sdk:'gradio',hardware:'zero-a10g'} (409 = exists), NDJSON commit POST /api/spaces/<id>/commit/main (header line + base64 file lines), POST /api/spaces/<id>/hardware {flavor:'zero-a10g'}, PUT /api/spaces/<id>/settings {private:true}. Not tried against the real Hub (no live call allowed); hardware id 'zero-a10g' is huggingface_hub's ZERO_A10G name, may be refused -> owner picks ZeroGPU in settings.
- Pins (PyPI 2026-11-03): gradio sdk_version 6.30.0, spaces 0.51.3, torch 2.13.0 (newest on ZeroGPU list), diffusers 0.41.0, transformers 5.20.2, accelerate 1.15.0, peft 0.21.2, safetensors 0.8.0, python 3.12. VAE madebyollin/sdxl-vae-fp16-fix.
- Measured latency/GPU per image: none yet (no live run). Mock uses 12.4 s.
- Pitfalls: envVar treats a set-but-empty env var as set (tests set HF_SPACE_TOKEN='' so the owner's .env is never read); artcheck's node() helper adds `--provider router` to gen/daily unless the call passes HF_SPACE_URL or its own --provider; in-process runLoop needs HF_SPACE_URL in process.env too (buildSpaceRequest reads process.env). Bash heredocs mangle backslashes and quotes: write patch scripts with the Write tool.
- Related: [[art-pipeline]], [[art-loop]].
