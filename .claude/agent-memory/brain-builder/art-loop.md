---
name: art-loop
description: #661 art:loop in daily.mjs - pass kinds and next-check rule, carry formula, launcher child, state file, test pitfalls
metadata:
  type: project
---

`daily.mjs --loop` (`npm run art:loop`) = `runLoop` repeating `main(argv, env, ctx)` with `--now --date <today>`; `ctx.result` carries `{kind, next, made, stop, spent*}`. Kinds and waits live in `nextCheck` (lib.mjs): share = min(+retry, midnight), provider = max(+retry, retry-after) (ArtError.retryAfter from classify), month = the 1st, complete = midnight (or manifest mtime change), cap = +1 min, error = +retry (ART_RETRY_HOURS, 4). The wait is on the log line itself ("check again <stamp> (why)"), so spentOn is not double counted.

Carry (manifest `allowance.carry`): budget = monthly x day/daysInMonth - spent before today; `--no-carry`/`ART_CARRY=0` or an explicit budget gives the old flat share. Existing artcheck share tests pass `--no-carry`.

State for `s`: `logs/art-loop.json` (`ART_STATE`; nextAt local stamp). Env knobs for tests: `ART_LOG`, `ART_STATE`, `ART_ASSETS`. Launcher: third child `art`, soft "stop" on stdin, restarted on `u`, `--no-art`/`ART_LOOP=0`.

**Why:** owner wanted the PRO credits used without hand-run `--max`. **How to apply:** artcheck runs the loop in-process on a fake clock (runLoop takes now/sleep/stopped); upcheck points the child at 127.0.0.1:9 so no real API is ever touched. In upcheck wait for the `art loop:` status line before asserting the ollama line (race).
