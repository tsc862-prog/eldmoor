---
name: new-world-setup
description: #133 New World setup page - how a setup becomes a world (init({setup}), seeded rng), pending-setup boot flow, runner launch rules, smoke/check scripts
metadata:
  type: project
---

New World setup (2026-11-01, #133): `src/sim/setup.js` (DOM-free rules: validateSetup, presets, pickSetup, applyMinds, planRunners), `src/ui/setup.js` (the form, relay status, runner launch), `scripts/setupcheck.mjs` (`npm run setupcheck`).

**Flow:** Start -> `queueNewWorld` (ui/save.js) stores `eldmoor.setup.pending`, erases the target world's save, reloads with `?world=` -> `boot()` takes the pending setup before any restore and calls `init({setup})` -> `main.js` calls `afterBoot()` which starts runners. No save and no pending = `bootKind()==='fresh'`: the page opens over a paused default world (autosave held) and "Play the default world" cancels.

**Rules worth keeping:**
- `rnd` in core/rng.js is now `()=>gen()`; `seedRng(n)` swaps it only for the span of `init` (opening). init without a setup never touches it, so seeded checks and old seeds are unchanged. The browser world after init uses Math.random again.
- Agent members are `markPlayer` + `fellowAgent` inside the sim at init, so they are AGENT (link "no runner") before any runner claims. F.minds = 'agent' if all five agents, 'relay' if mixed, else 'off'; the Fellowship button then reads "Minds: mixed".
- Runners: one Fellowship runner only when all five agents share provider+model, else one hero runner each, plus the DM. The relay's `max` (5 today) may refuse the last one: reported in the top bar, never retried silently. 404 on start is retried for 10 s (the page tells the relay its agent-played heroes a moment after loading). World pauses at most 6 s waiting for claims.
- "All local" = exactly one model: the relay's `ollama.loaded[0]` if it ever reports one (Ollama /api/ps is NOT exposed by the relay yet), else the first pulled.
- Peoples are applied by `restyle` (race, skin, hair, home town, ability rolls); names collide-check against the roster (' II').

**Why:** owner wants characters fully agent-played from world creation without starting runners by hand.
Related: [[new-world-opening]], [[fellowship-ui]].
