---
name: runner-acted-models
description: #681 sceneFrom/sceneDue/answeredScene rules and #677 modelListFrom, shapeList, prices and priceLabel
metadata:
  type: project
---

- #681: `sceneFrom` (scripts/local-agent.mjs) returns null for acted, for `your_turn === false` with `everyone_answers` or phase `turn`; every runner path now goes through `sceneDue(t, sess)` which also hides the scene whose `sceneKey` (title|kind|frame) the session answered within `ANSWERED_MS` (10 min; `sess.answeredScene`, set in `sceneTurn` on an accepted scene_act; top level of the session, not `sess.local`, so Claude sessions carry it too). Test in localcheck.
- #677: `modelListFrom(env, NAME, fallback)` in providers/index.mjs; `shapeList` in openai.mjs (allow order kept, else cheapest first, unpriced last, `dropped`, `prices`); Anthropic `allow`; UI label `src/ui/pricelabel.js` (lists carry `.prices`). Owner adds `OPENAI_MODELS=gpt-6-luna,gpt-6.1-terra` to .env.
- Pitfall: openaicheck had alphabetical model-order asserts in two places (adapter and /health).
