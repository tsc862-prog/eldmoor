---
name: give-by-name
description: #412 give takes item by name - packFind/packList in player.js, match tiers, count prefix, ambiguity rule, cleanArgs index->item, pitfalls
metadata:
  type: project
---

`give {item}` (#412, PR #421): `packFind(a,raw)` in `src/sim/player.js` (inv.js untouched by rule). Tiers: exact name
(normalized, plurals singularized) > consumable kind (USES[id].kind: potion, scroll, ration) > partial/word-prefix.
"2 x" / "all x" lead sets count; copied inventory text (" xN", parens) is stripped. Same-id stacks are not ambiguous;
quest items drop out of a multi-match. `packList(a)` = up to 5 "i: name xN". index+item both: ok if they agree.

**Why:** local minds failed give 4/4 with no index; owner rule accept more, refuse with the legal choices ([[tool-quickwins]]).

**How to apply:** reuse packFind/packList if drop/use_item/sell get names later. local-agent `cleanArgs` sends a
non-number `index` to `item`. Pitfalls: a fake party in a check needs `{mem:[...]}` (partyMates reads `mem`); writing
JS through a bash heredoc into a template literal ate the regex backslashes - use Edit for regex code.
