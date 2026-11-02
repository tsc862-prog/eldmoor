---
name: guild-rivals
description: #6 slice 1 guild rivalries (rivals.js): heat sources, declare/end thresholds, odds multipliers, Fellowship exclusion, measured rarity
metadata:
  type: project
---

Guild rivalries (PR #293, issue #6 slice 1; guild focus left for a later slice) live in `src/sim/rivals.js`.

- Heat only from events that already happen (veteran kill 2.5, lesser kill 1, crypt clear within a game day of an enemy clear 1, contested Kragmaw 1.5); halves every 2 game days; declare at 3.5, end below 1 or on disband.
- Effect is fixed multipliers on existing pvp.js rolls (duel x1.6, assist x1.5), and rivals.js uses no RNG.
- **Why:** multiplying existing rolls means a world with no rivalry rolls exactly like main, and the effect stays bounded so PvP deaths can't spiral (PvP is already ~44-48% of deaths).
- Fellowship guild is excluded entirely, so its story is driven by its agents, not by the background feud.
- Measured (10x120 min): rivalries declared in 4/10 runs, deaths 13.6/h vs main 14.6/h, PvP 44% both. Rare by design; if the owner wants more visible feuds, lower RIV.DECLARE before raising the multipliers.

**How to apply:** for guild focus (next slice), weight dungeonCheck/raidCheck/DM hook picks the same way: multiply existing odds, keep the Fellowship out unless its agents choose it.
