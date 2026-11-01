---
name: brain-design
description: Brain layer design as built in PR for issue #40 - decision points, relay protocol, model, schema, cost, test approach
metadata:
  type: project
---

Brain layer (src/sim/brain.js, scripts/relay.mjs, src/data/prompts.js), built for issue #40.

- Decision points: townPlan (zone for next trip + crypt call yes/no; hook = `townZone(a)` at town step 2 in heroes.js, `brainOk(a,'crypt')` in dungeon.js pool filter), fightOrFlee (`brainFight(a,m,mh)` in the heroes.js fight case, asks once when HP<50% vs mob 1+ levels above), say (`brainLine` in chat.js, cached per trigger, `e.ai=true`).
- Pattern: fire-and-forget fetch, answer validated against options the sim sent, parked in `a.brainPlan.{town,fight}` or a module line cache, applied at the NEXT decision point. Prefetch of townPlan happens in `brainTick` while the hero is in town. No RNG, no awaiting.
- Transient runtime state (busy, offline, line cache, clock) is module-level, not on S; only `a.brain`, `a.brainPlan`, `S.brainHeroes` are saved. Plan timestamps use the brain clock (sim seconds) which restarts at load, so plans stamped in the future are ignored.
- Relay: POST /decide {kind, snapshot} -> {choice, crypt?, line?} | {error}; GET /health; 127.0.0.1:8787; CORS only http://localhost:5173; 2.5 s abort; model `claude-haiku-5-5` ($0.10/$0.50 per 1M) via @anthropic-ai/sdk, `thinking:{type:'disabled'}`, `output_config:{effort:'low', format:{type:'json_schema'}}`. Disabled thinking on Haiku 5.5 is documented as allowed at effort high or below but was NOT verified against the live API (tests never call it).
- Measured (mock): snapshot ~130-300 tokens for a fresh hero; ~820 input tokens per call with system prompt; ~0.0001 USD per decision; ~120 decisions per hero-hour => ~0.012 USD/hero-hour, hard cap 240 requests/hero/real hour.
- Test approach: scripts/braincheck.mjs (mock relay + fake model client + seeded child processes proving a dead relay leaves the sim state identical). Math.random must be patched before importing the sim (rnd captures it at import).
- Sandbox note: Bash tool refuses heredoc-heavy or variable-in-option commands in worktrees; write scripts with the Write tool and run them plainly.
