---
name: token-deltas
description: #282 how the Agent SDK reports usage (cumulative modelUsage), usageDelta in behavior-turn.mjs, turn-line fields cacheRead/cacheWrite, legacy-line rule
metadata:
  type: project
---

Agent SDK 0.3.316 (`sdk.d.ts`): a `result` message's `modelUsage` (per model: inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens, ...) is CUMULATIVE for the query() call and, on a resumed session, already includes the earlier turns ("read the latest result rather than summing"). `total_cost_usd` is cumulative the same way. `result.usage` is the main loop only, per turn in streaming sessions, but the docs say prefer modelUsage. The old runners summed input+cacheRead+cacheWrite of that cumulative object, hence ~3.3M "tokensIn" per turn.

Fix: `usageDelta(sess, result)` in `scripts/behavior-turn.mjs`, called by agent-player, fellowship and dm-agent BEFORE the `lastTotal` cost baseline moves. It sums models, diffs against `sess.lastUsage` (saved in the session file), returns `{tokensIn (uncached input), tokensOut, cacheRead, cacheWrite}`. A total that fell = fresh count; an old session with cost history and no baseline reports nulls for one turn; no modelUsage = nulls, baseline kept.

Turn lines (`turns.jsonl`) now carry `cacheRead`/`cacheWrite` (null for local/OpenAI). Readers treat `provider anthropic` lines with no `cacheRead` key as legacy (`legacyTokens` in `behavior-log.mjs`) and leave them out of token averages (report and mind comparison say how many). Report columns: "tokens in/out per turn" + "cache read per turn". Test: behaviorcheck section 6c.

**Why:** token comparisons across minds (#280) were unusable. **How to apply:** any new Claude runner must call usageDelta, never sum modelUsage per turn.
