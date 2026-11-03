---
name: hf-provider
description: #552 Hugging Face router as mind provider `hf`: openaiAdapter options, free-tier rules, touchpoints, hfcheck
metadata:
  type: project
---

`hf` = `openaiAdapter` with options (`HF_OPTS`/`hfAdapter` in scripts/providers/openai.mjs): name/label/keyName HF_TOKEN, `free` (cost 0, known; 402 or 429 about credits -> kind `quota`, "hf: free allowance used up"), `sendEffort:false`, `tokensField:'max_tokens'`, no model filter. Base https://router.huggingface.co/v1, env HF_TOKEN / HF_MODEL / HF_BASE_URL.

**Why:** owner keeps no payment method and wants the free allowance used fully (#177); never send provider/billing options.
**How to apply:** touchpoints are providers/index.mjs (PROVIDERS, makeProviders), relay makeLimits (hf, RELAY_HF_CONCURRENCY 2), agent-sessions RUNNER_PROVIDERS, agent-chat `openaiRunner` (routes rs.provider==='hf'), agent-player/fellowship (`openai||hf`), brain.js MIND_PROVIDERS, setup.js SETUP_PROVIDERS, UI pickers (hfModels, first 80). hf is not local (runners keep budget/turn caps) and takes no Claude slot. Test: `npm run hfcheck` (own mock router, free port). Pitfalls: checkStart returns `{req}`; heroes need `alive:true`; python edits of CRLF files are fine in text mode.
