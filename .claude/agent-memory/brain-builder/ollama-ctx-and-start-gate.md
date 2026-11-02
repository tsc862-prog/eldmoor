---
name: ollama-ctx-and-start-gate
description: #221 one num_ctx in the Ollama adapter (numCtxFrom), repeat-limit retry, ctx warning; #222 start gate protocol (/play/ready warming/ready/failed per runner, warmup.mjs, rungate Start anyway, --wait-ready)
metadata:
  type: project
---

Built 2026-11-01. #221 merged as PR #232; #222 is PR #236 (branch brain/ready-gate, stacked on #221).

**#221 one num_ctx.** Ollama reloads the whole model when num_ctx changes; a request without it gets the server default (32768 on the owner's PC).
- Mismatched callers before the fix: the agent loop sent 16384. chatAsk (scene and reflection), the relay's call(), and the DM table and talk voices (adapter call()) sent none. fellowship.mjs and dm-agent.mjs sent a value only with --num-ctx.
- Rule now: the adapter (providers/ollama.mjs) sends options.num_ctx on EVERY call() and chat(). The value comes from `numCtxFrom(env)`: OLLAMA_NUM_CTX, default 16384. Per-call numCtx is ignored. Never add one at a call site.
- Shown in: /health providers.ollama.numCtx, the relay start log, the runner start line, and the supervisor view numCtx/ctxWarn (UI state line `ctx 16384`).
- Warning: `held()` returns /api/ps rows with context_length. localModelNote warns "Ollama holds X at 32768; runners ask 16384, so it reloads each time".
- "prediction aborted, token repeat limit reached" (live qwen2.5:14b): the adapter sets e.repeatLimit.
  - localTurn retries once with the history halved (trimHistory) at temperature 0.4.
  - A second abort sets stat.looped, which makes an empty turn. localWorked returns null and failTracker.ok(null) leaves its count unchanged, so the turn does not count toward --max-fails.
  - chatAsk retries once at 0.2.
  - Mock models: mock-loop and mock-loop1.

**#222 start gate protocol.**
- Runner side: scripts/warmup.mjs warmUp() posts `POST /play/ready {hero|role:'dm', runner, state:'warming'|'ready'|'failed', model, ms?, error?}`.
  - The warm-up is one tiny structured call ({ready:boolean}).
  - Local: adapter.chat (goes through the runner's Ollama queue). Paid: adapter.call(). Claude uses claudeWarmAdapter(key), the existing anthropic.mjs call().
  - It runs before the first turn in agent-player (all 3 providers), in each member's loop() in fellowship, and in the DM runner (both providers).
- Relay side: readiness is kept per runner id (readyOf checks that the current claim has the same runner), so a restart resets it to 'claimed'.
  - /play/health: heroes[].ready plus warm, and dm.ready.
  - The WS links message carries `ready`.
- Page side (rungate.js):
  - A connected seat must also be 'ready'.
  - Start anyway waives a seat: 'live' waivers drop when the runner goes away, 'missing' waivers drop when a runner claims.
  - lastRd keeps readiness through the link grace period.
  - The probe takes optional ready(a) and dmReady(). A probe without them counts every seat as ready, so old tests keep working.
  - Frames: player-bridge agentReadyWord / dmReadyWord.
- play-headless --wait-ready holds stepping for all living agent heroes plus the open DM seat. Without the flag nothing changes.
- Tests:
  - localcheck: mock-slow (2.5 s warm-up) and mock-down (500 error).
  - uismoke: start gate block.
  - Pitfall: warm-up requests use temperature 0. Checks that assert sampling must filter out bodies with format.properties.ready.

**Pitfall (paint):** in rungate, resetting `sig=''` before paint skips hiding the bar, because '' equals the hidden signature. Use `sig=null` to force a repaint.
