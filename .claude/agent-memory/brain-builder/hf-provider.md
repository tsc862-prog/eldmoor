---
name: hf-provider
description: #552 provider `huggingface` (router): openaiAdapter options, curated verified model list, estimated_cost, json_object fallback, touchpoints, hfcheck
metadata:
  type: project
---

`huggingface` = `openaiAdapter` with options (`HF_OPTS`/`hfAdapter`, scripts/providers/openai.mjs): HF_TOKEN, `max_tokens`, no reasoning_effort, cost from `usage.estimated_cost` (unknown when absent), `models` curated (`HF_MODELS` default four, `HF_MODELS=` env overrides via `hfModelList`) verified once by `status()` with one tiny call per model (drops `model_not_supported`), strict json_schema then json_object fallback (`withSchema`), 400 about tools -> `noTools` (JSON-actions loop). 402 / credit 429 -> kind quota "Hugging Face allowance used up (recharge is off)...".

**Why:** owner keeps recharge off; the free allowance is shared with the art pipeline (#177), so never send billing options and do not spend calls: runners (`hfRunner` in agent-chat.mjs) skip the status check; only the relay verifies at start.
**How to apply:** touchpoints providers/index.mjs, relay makeLimits (RELAY_HF_CONCURRENCY 4) and start log, agent-sessions RUNNER_PROVIDERS, agent-player/fellowship (`openai||huggingface`), brain.js, setup.js, UI pickers (hfModels). Not local, no Claude slot. `paidLine` prints 6 decimals under $0.0001. Test: `npm run hfcheck`. Pitfalls: checkStart returns `{req}`, heroes need `alive:true`; long bash heredocs with quotes can break, use the Write tool; python text-mode edits of CRLF files keep CRLF.
