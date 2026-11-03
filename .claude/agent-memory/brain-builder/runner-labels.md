---
name: runner-labels
description: #563 why runner labels flipped (two sources: supervisor list vs relay claims), the steady-label rules, left members, implied ready, no turn caps (budget only), labelcheck
metadata:
  type: project
---

#563 (2026-11-03): owner saw frames rotate "no runner" / "Fellowship runner" with Claude members.

**Cause found in the owner's logs:** the app-started Fellowship runner had the old per-member cap of 6 turns. A member
that hit it (`[Branan] done (max turns)`, 07:29:09) released its claim while the runner process played on for the
others. The page reads two sources: the relay's claims/links (link -> mind label, readiness) and the supervisor's
`GET /play/runner` list, whose fellowship `heroes` were every living member. So the frame said "Fellowship runner live"
and the mind label "Agent (live) · claimed" (20 s of LINK_MS activity without a claim: no model tag, no ready, gate held
"waiting for its first model answer") then "no runner". Page reloads ("page went away") added a moment of 'none'
before the first links message. world.jsonl showed relay links never 'none' while members were held.

**Fixes (how to apply when touching labels):**
- Relay: release / dropRunner also clear the hero's activity (`act`), so a released seat is 'none' at once;
  `holderOf(id)`; a hello pushes links at once; a turn line (`/play/behavior/turn`) from the claim holder marks the seat
  ready `{implied:true}` when it has no warm-up record (even with no behavior logs; it still answers 404 then). Not over a failed warm-up: localcheck expects a crashed warm-up to keep the world held.
- Supervisor `view()`: `left: [{id,name,why}]` for members it held (claim under `host:pid`) and let go, or named in a
  `[Name] done (why)` line; they leave `heroes`.
- Page: `runnerFor` falls back to a runner whose `left` has the hero; `runnerControl` says "done with X (why)";
  the gate skips the 30 s grace for a left member and its button restarts the runner's kind (fellowship), never a hero
  runner (paid seats would refuse it). Held link (connected or waiting) reads "live" everywhere (mind label, Agent tab,
  runner state text, r-waiting colour = r-live); the relay still reports connected/waiting. Before the first links
  message after a (re)connect the link is 'connecting'. `bridgeFeed(m)` is the test seam.

**No turn caps (owner, same PR):** "I don't care about turns, I just want to limit cost." `turnCap()` in pacing.mjs
returns Infinity unless `--max-turns` is asked; RUNNER_KINDS defaults maxTurns null, budgets $1 hero / $2 Fellowship /
$1 DM, caps $5/$10/$5. Page: budget select beside the mind picker (`data-runbudget`, $0.50-$10) and in the Agents panel;
no Turns select; old saved turn limits are ignored. Runner line: "$0.081 of $2.00".

`npm run labelcheck` (in CI): real attachPlay + attachRunners (fake child) + page modules in stubdom, fake clock via
Date.now override. Pitfalls: the page polls the runner list every 2 s (skip the first 2 fake s after a change); the gate
recomputes at most once per (fake) second, so advance the clock before reading it; normalise "last N s/min ago".

Related: [[app-runners]], [[runner-pacing]], [[ollama-ctx-and-start-gate]].
