---
name: staged-scenes
description: #132 (part of #66) DM agent staged scenes + at-the-table DM calls - stage_scene/table_call/table_answer protocol, call kinds and budgets, refusals, table voice runner, test approach and pitfalls
metadata:
  type: project
---

Built 2026-11-01 on branch ai/dm-staged-scenes (PR "Part of #66, closes #132").

- Sim: src/sim/staged.js (S.staged {seq, day, cur rec, past, stats}). Kinds elite/ambush (bestiary foes, lvl <= party avg+2, ask > avg+3 refused, band lo > avg+3 refused), meeting/social (create_npc lever, want required), trap (hidden, DC 8+ceil(avg/2)+1, never below 10% HP), mystery (mark_place marker, reveal on success). Cast walks to the member (mobs via m.dest/home, NPC via w.stroll), re-anchors if >16 tiles; trap/mystery placed 2.5-4 tiles ahead. Meet within 4.5 tiles -> openScene. Expiry 6 game h.
- table.js hooks (additive): setSceneKind(kind,{options,reflex,apply,outcome}) and setStageHooks({tick,onFrame,onBeat,fill,live,done}); sc.ctx.labels relabels legal actions; foeOf reads ctx.mobs; runTurns now a for(;;) with callWait before each turn.
- Calls: voice (after frame), outcome (after every beat), one complication (after half the beats; legal sets per kind: none/omen + falter/reinforce, rival, tremor). TABLE.dmMs 6000 real ms per call at 1x; waits only if the runner polled table_call within STAGE.POLL_MS (5 s, Date.now) and dmMiss < 2; else scripted fill at once. 3x/8x: all scripted, instant.
- Logging: every stage/refusal/roll/call/payoff via dmlog with detail.by 'dm-agent' (scripted fills by 'scripted') and heroes [] on purpose: fellowship.js readDm copies entries naming members into the campaign log and memories, which would carry DM bookkeeping words ('Staged ...') to the agents. F.tableDm is bumped after the scene anyway.
- Runner: scripts/dm-agent.mjs tableVoice({base, adapter, model, tool}) polls table_call (400 ms hot / 2.5 s idle, no model), answers with one structured adapter.call (schema {text, pick enum legal|['']}); Anthropic default claude-haiku-5-5 (--table-model / DM_TABLE_MODEL), Ollama uses the seat model. relay-mcp skips log lines for idle table_call polls.
- Tests: tablecheck --staged child (fresh world; init does not reset S), dmcheck 1b refusals (17) + tableVoice over attachPlay with a mock adapter. Pitfalls: create_npc lever cooldown 60 min/region + 2/region/day - reset S.levers.cd/day in tests; at 3x the scene finishes inside openScene so S.table is never seen (check the payoff log); JSON.stringify of dmlog summaries is circular (hero objects) - join string parts.
- Live 2026-11-01 (headless :8791, qwen2.5:14b): Ollama was busy with the owner's other work (a 5-token chat did not answer in 60 s), so no latency number yet; the first call hung 305 s because the Ollama adapter ignores timeoutMs - tableVoice now passes AbortSignal.timeout(budget). The fallback was proven live: a meeting (27 s incl. walk) and an elite (41 s) ran with every slot scripted. Haiku 5.5 latency and cost per call are still to measure (est. ~600 in / 40 out = about $0.00008 a call).
