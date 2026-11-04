---
name: cost-report
description: "#799 cost-report.mjs: sources, wake classes, game hours from digests, tokens-a-call estimate, measured spend, lever findings"
metadata:
  type: project
---

`npm run cost-report` (issue #799) reads turns, digests, relay lines, runner logs and fellowship-runs; `costcheck` is its fixture test.

- Money is always the logged turn cost. tokensCached (#778) sits inside tokensIn; cacheRead sits outside it. ctx (#787) replaces the estimate of tokens a call (prompt tokens over tool calls plus one).
- Game hours = digests x minutes. Clock steps fail: worlds reset often and slow turn lines land late; only used with no digests.
- DM voices are only in dm.log; a DM run is placed in the world holding most of its turn lines. Relay cost is on decision lines only from #799 on.
- Measured 2026-11-04 (all logs): $44.34; stepping $38.92, 92% Haiku, 2319 of 9346 calls past 100k on turns costing $30.16. Haiku turn $0.0137 under the line, $0.0515 past it, fresh about $0.007. 8 Fellowship runs at $2 from 07:28 to 08:29 UTC = $16.73 (7 of them in 22 minutes), plus $14.1 on hero runners.
- Biggest wake: hear: party, 28% of stepping spend; 176 of 214 such turns on the last day came within 60 s of the hero's own last turn.

**Why:** owner's standing rule: review costs regularly, keep personality and story, one mind per hero.
**How to apply:** measure each lever before and after with this report; remeasure after #787 before sizing the others. Pitfall: backslashes in bash heredocs get eaten here, so edit regexes with Edit or Write.
