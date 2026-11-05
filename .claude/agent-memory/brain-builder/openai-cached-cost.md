---
name: openai-cached-cost
description: "#728 OpenAI cached input pricing: PRICES.cached, usage.cached, turn line, tokensCached, mock setCached"
metadata:
  type: project
---
openai.mjs `finish()` reads `usage.prompt_tokens_details.cached_tokens` (capped at prompt_tokens) into `usage.cached`; `costOf(model,in,out,cached)` prices it at `PRICES[m].cached ?? in`. Cached rates exist only for gpt-6.1-terra 0.05 and gpt-6-luna 0.01 (issue, read 2026-11-03); others stay full-rate upper bound. HF (costField) and Gemini (costFn) cost paths unchanged, they just carry `cached`. `usage.in` stays the whole prompt. local-agent `stat.cached`, `paidLine` prints "tokens in N (M cached)", turn lines get `tokensCached`. Mock: `mock.setCached(n)`. Pitfall: mock-openai only serves its MODELS list (gpt-6-astra has no cached price).
