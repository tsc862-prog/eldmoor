---
name: semantic-recall
description: #553 semantic recall — relay embeds, game folds _sem into keyword score; _pool/_sem protocol, cache path, fallbacks, test pitfalls
metadata:
  type: project
---

Design: the sim stays pure. `recall`/`journal_search` (and DM `recall`) accept relay-only args `_pool:true` (returns `{pool:[{k,text}]}`, k = `semKey(text)` hash from `src/sim/semkey.js`) and `_sem` ({k: 0..1}). Relay (`attachPlay` option `embed`, `scripts/embed.mjs`) strips both from agent args, asks the game for the pool, ranks by cosine and passes `_sem`; any miss = tool answers exactly as before. Bonus `SEM.MAX` 2 vs title/tag word 3; sem-only hits count recency/4, pin .5, marked `semantic:true`.

**Why:** owner wanted meaning search without a game-side network call or save growth. **How to apply:** new memory-like tools get the same `_pool`/`_sem` pair; never put vectors in S.

- Cache: `logs/agents/<world>/<id>-<name>/vectors.json` (DM `dm/`), Float32 base64, model-checked, pruned on a full pass; `drop()` for fallen heroes; purgeWorld removes it with the folder.
- Budget 300 ms (`EMBED_BUDGET_MS`), cold cache fills in background; failure pauses 30 s; gated on `/api/tags` listing the model (cached 10 s). nomic gets search_query/search_document prefixes. `EMBED_MIN`/`EMBED_FULL` map cosine to strength (guesses for nomic, not measured on the real model: the owner's Ollama was off limits).
- Pitfalls: playLog/DM calls args must skip `_` keys (else `_sem` lands in the save); journal_write also makes a memory, so journal text competes in recall tests; mock embed uses 64 hashed noise axes or unrelated texts collide; `rm -rf`/node_modules symlink for the hash-compare dir are denied: use a fresh scratchpad folder.
- Headless `--embed` is opt in so checks never reach 11434. Real latency/cost not measured (local, $0).
