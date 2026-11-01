---
name: app-runners
description: App runners (start/stop agent runners from the game page via the relay supervisor), the runner route shapes other PRs build on, Claude slot accounting, and the relay's Anthropic concurrency limiter for the owner's low org cap
metadata:
  type: project
---

Built 2026-11-01 on branch infra/app-runners (owner: "launch the runner via the app"; PowerShell's execution policy blocks npm, so terminals are a pain for the owner).

- Supervisor `scripts/runners.mjs` attachRunners(server, {play, enabled, origin, base}) on the relay (`--runners` / RELAY_RUNNERS=1) and play-headless (`--runners`). Route shapes are a contract (the DM agent PR builds Start DM buttons on them): GET /play/runner, POST /play/runner/start {kind, hero?, provider, model, maxTurns, budget}, POST /play/runner/stop {kind, hero?} (or {key}). Keys 'hero:<id>', 'fellowship', 'dm'. Kinds are a table (RUNNER_KINDS); coordinator asked to keep it generic. 'dm' spawns scripts/dm-agent.mjs (other agent, branch ai/dm-agent-1), one at most, 501 "not installed yet" until the file exists, session logs/agents/dm.json read for its provider.
- Routes sit under /play/runner but must answer the page (Origin localhost:5173 + CORS preflight), while relay-mcp's /play/* refuses any Origin; so attachRunners re-orders 'request' listeners and goes in front. attachPlay now also returns claimed(id) and dropRunner(prefix) (claims of a dead child, runner id `${hostname()}:${pid}`).
- Stop protocol: child env ELDMOOR_SUPERVISED=1, stdin piped; "stop" line or stdin EOF -> onSupervisorStop() aborts the SDK turn (abortController), releases, exit 0. Supervisor kills after 6 s. Stdin EOF is the backstop when the host is killed hard (verified: SIGKILL host -> child exits). Windows child.kill() is TerminateProcess (no handlers), hence the stdin design.
- State: starting (no claim) / live (link connected) / waiting / stopping / stopped (exit 0 or asked) / crashed (+ last error-ish line). Turns and cost parsed from `[turn N` and `| run $X` lines.
- Claude slots: RUNNER_CLAUDE_MAX (default 3) concurrent Claude requests across runners; hero = 1, fellowship = min(Claude members, free) passed as fellowship.mjs `--claude-concurrency N` (semaphore, scene turns first); provider from request, else saved session runner.provider, else AGENT_PROVIDER, else anthropic.
- Relay limiter `scripts/providers/limiter.mjs`: RELAY_ANTHROPIC_CONCURRENCY default 2; decisions ahead of writing kinds; queued decisions dropped on abort or when starting with < min(300 ms, tmo/4) left (that /4 matters: braincheck uses timeoutMs 120); 429 -> pause (retry-after or 1-2-4 s, max 10 s), only writing kinds retry (3x, jitter); /health `queues.anthropic` {max, inflight, queued, rateLimited, dropped, served, paused}. Owner's live log before the fix: of 400 entries, 170 timeouts and 150 x 429 "concurrent requests ... exceeded your organization's limit".
- UI `src/ui/runners.js`: polls GET /play/runner (2 s while any runner is live, else 5 s) at the bridge's relay URL; buttons use pointerdown in capture phase because the hero card rebuilds every 0.3 s and swallows clicks. Picker: saved mind / Claude / pulled Ollama models.
- Pitfall: Python text-mode writes on Windows turn files CRLF (git normalizes to LF; *.cmd forced CRLF in .gitattributes for start-eldmoor.cmd). Use newline='' or the Edit tool.
- Tests: `npm run runnercheck` (CI): rules, fake-child routes, end to end with mock Ollama (scripts/mock-ollama.mjs, shared with localcheck), Fellowship runner, relay script on/off, limiter with mock 429 client. ~1-2 min.
