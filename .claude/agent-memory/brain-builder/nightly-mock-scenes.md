---
name: nightly-mock-scenes
description: #822 nightly run reflex-scenes cause - mock-tools never answers a forced scene, so every scene went to reflex; mock-table fixes it; stuck-state reading
metadata:
  type: project
---

The nightly run (`scripts/nightly-run.mjs`, mock Ollama) failed `reflex-scenes` on every run since it began (x66 on 2026-11-04, x36 on 2026-11-05). Cause: `mock-tools:1b` has no branch for a forced scene answer (`format.properties.option`), so it returned a tool call or prose, the runner said "N answers were not one of ..." and the table fell to reflex (report: 83 scenes, 0 agent turns, 339 reflex). Not a #868 regression and not a game fault.

**Fix:** `mock-table:1b` in `scripts/mock-ollama.mjs` plays like mock-tools but answers a scene with a legal option (press, listen, speak, else the first) and a line carrying its name and a counter (a near-copy of another member's line is refused by #571). The nightly run uses it. A local run with mock-tools also ends early ("5 failed or empty turns in a row" after the scene misses), so mock-tools is not a fit for any long scene-heavy run.

**How to apply:** a check that needs members to act at the table needs a mock that answers the option schema; keep mock-tools untouched (localcheck counts its calls).

stuck-state in the nightly report: see the PR for the measured split between the town-edge hunt hole (#903) and mock minds that only wait.
