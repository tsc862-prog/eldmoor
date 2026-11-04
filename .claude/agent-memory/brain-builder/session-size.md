---
name: session-size
description: #787 keeping Claude sessions under Haiku's 100k price line - verified CLI facts, roll protocol, compaction net numbers, real cost per turn, test pitfalls
metadata:
  type: project
---

#787 `scripts/session-roll.mjs`. Roll between turns at `ctx` >= 80k (DM 150k, 80k on Haiku), compaction net via `CLAUDE_CODE_AUTO_COMPACT_WINDOW` = roll + 40k through `query()` env. `npm run sessioncheck` runs the REAL CLI against a mock Messages API (zero spend), hero, Fellowship and DM runners end to end.

**Verified, SDK 0.3.316 / bundled CLI 2.1.316 (read in claude.exe; its JS is plain text, search with Python mmap for `function jS(`, `function DZ(`, `function EJ(`):**
- Threshold = window - min(maxOutput, 20000) - 13000. Window 100000 -> 67k (not 100k as the issue assumed), 120000 -> 87k. Default on Haiku 967000. Env is clamped to 100k-1M. `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` also exists; `settings.autoCompactWindow` is a second route (not used).
- The env var reaches the CLI through `query()` `env`; `getContextUsage({detail:'summary'})` works on the init message and returns `autoCompactThreshold`, `autocompactSource: 'env'`.
- Compaction also fires between two calls of one turn. The system prompt is resent unchanged, but the first `x-anthropic-billing-header` line of `system` varies, so compare by content or length.

**Pricing (platform.claude.com pricing page, read 2026-11-04):** Haiku 5.5 <=100k: $0.10 in, $0.125 write, $0.01 read, $0.50 out; >100k: $0.50, $0.625, $0.05, $2.50. The prompt length counts input + cache reads + cache writes. Only Haiku has the line.

**Measured, 20 owner hero logs (Haiku), by average prompt per call:** <50k $0.0061/turn, 50-80k $0.0100, 80-100k $0.0336 (a turn crosses the line inside itself), 100-200k $0.0381, 200k+ $0.0439. About 10 calls a turn when fresh, 3-5 past 100k. Growth p50 10k, mean 29k tokens a turn, so a member rolls about every 5 turns.

**Why:** owner spend (issue evidence), and the roll cannot delay a scene while compaction can fire mid-turn. **How to apply:** continuity is the known cost of rolling that often; `SESSION_ROLL_TOKENS=0` gives summaries instead (compacts at 67k, mid-turn). A `/compact` prompt between turns is the untested better idea if owners dislike the amnesia.

**Pitfalls:** mock must answer a compaction with text (the summary request carries the tools; a tool_use answer makes the attempt fail silently), and must look at the last TWO messages for a tool_result (the CLI adds a budget line after it). Mock turns take about 1 s, so give runners room: no small `--max-turns` before an async step, and wait for the call, not just the log line. A Fellowship world at `--speed 8` opens a Crypt vote fast and rolls are rightly held: use `--speed 1`.

See [[agent-player]], [[runner-pacing]], [[token-deltas]], [[scene-grab]].
