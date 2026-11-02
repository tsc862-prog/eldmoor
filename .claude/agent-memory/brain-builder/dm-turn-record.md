---
name: dm-turn-record
description: #181 S.dmAgent.turns ring, turn_end report path from relay, UI fallback, pitfalls
metadata:
  type: project
---

The DM per-turn record (#181) lives in `S.dmAgent.turns` (newest first, ring of `DMA.TURNS_KEEP` 40, plus `tseq`, `tv`), saved with the world; older saves create it on the next DM call.
Every DM tool call lands in the open turn (`recordTurn` in `src/sim/dmagent.js`); a turn closes when the relay passes the runner's turn report to the game as `dmAct('turn_end', {turn, model, provider, cost, seconds, tokensIn, tokensOut})`. A stale open turn (240 game min quiet) is closed by the next call.
**Why:** cost and model are only known to the runner, which already posts `/play/behavior/turn`; the relay's DM branch of `behaviorTurn` (after the claim check) forwards them via `be.dmCall('turn_end')`. `turn_end` is not in DM_TOOLS, so the agent cannot write it and no hero path reads it (channelcheck clean).
**How to apply:** the cards in `src/ui/dmturns.js` read `dmTurnLog()` when non-empty, else the page's localStorage log; the record has the same fields as the page's cards plus `cost/model/seconds/tokens`. The relay path needs a `behavior` writer, so dmcheck stubs one.
