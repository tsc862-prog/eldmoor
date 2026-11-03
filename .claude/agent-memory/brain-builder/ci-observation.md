---
name: ci-observation
description: "#574 CI watchers: flakehunt, nightly-run thresholds, shoot.mjs, red-main alarm, ci-issue/pr-comment helpers, pitfalls"
metadata:
  type: project
---

Four non-required workflows beside ci.yml: nightly-flakes.yml (scripts/flakehunt.mjs, "Nightly flake report"), nightly-run.yml (scripts/nightly-run.mjs + nightly-thresholds.json, "Nightly agent run failed"), screenshots.yml (scripts/shoot.mjs, PR comment, images on orphan branch ci-shots), red-main.yml (workflow_run on CI for main, "main is red", label red-main; an open one is a merge stop).

**Why:** per-PR CI cannot see flakes, long-run idling, visuals or a broken main.

**How to apply:**
- Helpers: `scripts/ci-issue.mjs open|close --title` (one open issue per exact title, creates label), `scripts/pr-comment.mjs <pr> <marker> <file>` (upsert by hidden marker; hash-guard now uses it, `--edit-last` would clobber other bot comments).
- nightly-run: real runners vs mock Ollama (`mock-tools:1b` Fellowship, 1 min = ~300 turns). The mock cannot play the DM seat (hero tools only), so the DM stays scripted. Mock minds only wait: idle/no-aim/repeated-narration anomalies are expected, thresholds limit stale-claim, stuck-state, relay-failures, flood, idle hours (from anomaly evidence.minutes), table scenes >= 1, autopilot share, deaths, empty rate. `--check-only` re-reads an out dir.
- shoot.mjs: `vite preview` binds IPv6 only by default: pass `--host 127.0.0.1` or Chrome gets connection refused (screenshots still "succeed" showing the error page). CHROME_PATH, CHROME_NO_SANDBOX=1 on CI.
- YAML pitfall: a plain `run:` scalar containing ": " breaks parsing; use `run: |`. Validate workflows with python yaml.
- Not run in a real GitHub environment from the worktree: the first nightly and a workflow_dispatch of red-main (simulate failure) are the live proofs.
