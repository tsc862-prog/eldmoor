---
name: grab-cost
description: #747 grabSpend in pacing.mjs counts an aborted (scene grab) Claude query toward run and session cost; flag grab-cost
metadata:
  type: project
---

An aborted Agent SDK query sends no `result`, so `grabSpend()` (scripts/pacing.mjs) collects assistant-message usage (dedupe by message id, max per field) and prices it with the anthropic PRICES (cache read 0.1x, write 1.25x). Nothing reported: chars sent / 3 at full input rate + `GRAB_EST_OUT` 400 output tokens. Unpriced model = dearest listed.

**Why:** owner limits paid runners by dollars only (#563). **How to apply:** fellowship.mjs and agent-player.mjs add it only when `grab.grabbed() && !result`; turn line flag `grab-cost:reported|estimated`. The in-flight model call not yet reported is not counted (known gap). scenewaitcheck G tests the helper, not the runners.
