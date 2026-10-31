---
name: weather-system
description: Design decisions behind per-zone weather (issue #7, branch world/weather): state table, multipliers, where the shared one-line hooks live, measured death impact
metadata:
  type: project
---

Per-zone weather lives in `src/sim/weather.js` (state machine + `speedMul/sightMul/isStorm/weatherName/weatherKind`) and `src/render/weather.js` (zone-span tint + stateless particles). State is lazily created as `S.weather` on the first `weatherTick`, so `state.js` stays untouched.

Decided table (clear ~50% by weight; clear spells 1.5-3 game h, weather 1-2.5 h):
- Thornvale: clear | rain (.9 speed, .9 sight) | drizzle (.95 / 1)
- Mirefen: clear | fog (1 / .5) | rain
- Cinderpass: clear | ashfall (.95 / .85) | ashstorm (.7 / .6, storm)
- Hoarfell: clear | snow (.8 / .85) | squall (.65 / .6, storm)
Ashfall multipliers were not in the brief; I chose .95/.85 (mild, like snow's sight) and should be kept gentle.

Shared hooks are deliberately single lines so parallel agents (traits, chatter) can merge cleanly: `moveTo` step x `speedMul`, `findMob` range x `sightMul`, hunt go-home `||isStorm(a.zone)`, mob ambush 1.3 x `sightMul`, pvp 3/8 tiles x `sightMul`, `drawWeather` after the night block, one hero-card meta line.

**Why:** issue #7 wanted weather that changes play without touching hero AI structure; the storm retreat reuses the existing go-home check rather than a new state. Known trade-off: during a storm, heroes bounce town -> travel -> hunt -> return until it passes, because `town` does not check the weather (would need an ai-designer edit).

**How to apply:** baseline on origin/ai/parties was 40-42 deaths per 60 min; with weather 42-44 (about +5%, inside the 10% tolerance). If deaths climb later, soften squall/ashstorm speed first, not sight. The render budget is about 200 span rects + up to ~300 particles per frame; keep new kinds inside that. If a `town`-state weather wait is wanted, hand it to ai-designer.
