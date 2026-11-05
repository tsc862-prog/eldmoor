---
name: gemini-provider
description: #672 Gemini (provider id google): compat endpoint via openaiAdapter hooks, native generateContent fallback, free tier = budget, thought signatures, error mapping, DM path, googlecheck pitfalls
metadata:
  type: project
---

Gemini landed as provider `google` (label "Gemini", tag `<model> · google`) in #672, on the #552 HF pattern.

- `scripts/providers/google.mjs`: `googleAdapter` = `openaiAdapter({...GOOGLE_OPTS, ...})`; `googleFromEnv(env)` reads GOOGLE_API_KEY, GOOGLE_MODEL, GOOGLE_BASE_URL, GOOGLE_TIER (paid|free, default free), GOOGLE_NATIVE.
- openaiAdapter got generic hooks (defaults keep OpenAI/HF unchanged): `effortValue(m)`, `headroom(m)`, `costFn`, `mapError(status, body, msg, retryAfter)`, `onBadRequest(err, body)` (one retry with a new body), `native {structured, always}`, `modelId`. Errors given as a one-element array are unwrapped. `scrub` exported, also scrubs `AIza...` and `?key=`.
- Docs read 2026-11-03 (ai.google.dev now 301s to aistudio.google.com/docs/...): compat accepts reasoning_effort minimal|low|medium|high, "none" only on 2.5 Flash; 3.x cannot turn thinking off -> send "low" + 1024 max_tokens headroom. Thinking tokens billed as output; out tokens = max(completion, total - prompt). Rate-limit page prints NO free-tier numbers (only in AI Studio); 429 RESOURCE_EXHAUSTED; daily reset midnight Pacific. Native: `x-goog-api-key`, `responseJsonSchema` (docs say use it over responseSchema), finishReason MAX_TOKENS/SAFETY..., `usageMetadata.thoughtsTokenCount`.
- Error mapping: 400 "API key not valid" / 401 / 403 -> auth "bad or missing GOOGLE_API_KEY"; 429 naming PerDay/daily -> quota (free: "Gemini free quota used up for today; ..."); other 429 -> rate with retry delay parsed from "retry in Xs" or RetryInfo. Use the untruncated `j.error.message` (apiError's msg is cut to 160 chars and loses "retry in").
- Free tier: costFn returns 0, costKnown true; paid tier prices from PRICES. Runners keep a budget (never reached on free).
- Limiter: `makeLimiter({rpm})` spaces starts (RELAY_GOOGLE_RPM); `rateLimitOf` now returns null for `kind: 'quota'` (fixes HF/OpenAI quota 429s being retried for writing kinds).
- Thought signatures: compat tool_calls carry `extra_content.google.thought_signature`; chat() keeps it, toOpenAI sends it back, local-agent keeps it in turnMsgs and drops it when pushing to L.history (`noSig`). Do not strip in `strip` (it maps turnMsgs too). 400 naming thought_signature -> onBadRequest flattens calls to text.
- DM: rides the Ollama DM branch (`gem` flag) with the adapter from openaiRunner, voices on the same model with 8 s budgets, paidLine cost lines; openai and huggingface too since #824, see [[dm-every-mind]].
- fellowship.mjs: each compat member keeps its own adapter `m.ad` (the old shared `openaiChat` was last-one-wins across providers).
- googlecheck pitfalls: the mock answers the DM's turn by checking `tools` for `dm_status`; keep the mock's 400 bad-key as an array to cover the unwrap.

**Why:** owner's free Google account = the second zero-cost mind after Ollama.
**How to apply:** new OpenAI-compatible providers go through these hooks, not forks of openai.mjs. Live latency/cost per decision not measured yet (no key used); measure on first live run. Related: [[mixed-minds]], [[agent-player]].

Merged with #688 (#677 model lists and price labels): google gets `allow: modelListFrom(env, 'GOOGLE_MODELS')`; openaiAdapter options `priceOf` (sort; Gemini = its PRICES) and `labelOf` (shown price; Gemini free tier -> {in:0,out:0} for free-tier models, paid-only keep their price). `shapeList(models, allow, priceOf, labelOf)` returns prices only when a labelOf exists. UI lists carry `.prices` (googleModels, setup googleList) for `priceLabel`.
