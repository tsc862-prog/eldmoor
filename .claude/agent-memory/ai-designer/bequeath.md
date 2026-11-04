---
name: bequeath
description: #631 will tool (src/sim/will.js) - hooked in fall() not slay/goDown, act:false so a downed hero may write it, estate held until heir rests, companion-only by spec
metadata:
  type: project
---
A hero's will (#631): `bequeath {to, item|gold, words}`, `a.will` rows, executes in `fall()` through `setFallHook` (heroes.js; set in index.js body, not at will.js top level, to dodge the import-cycle TDZ on `let fallHook`).

**Why fall() and not slay():** crawl.js, dungeon.js and sites.js call fall() directly, so slay() is not the only road to death; fall() is. goDown never touches the will, so downed-then-rescued keeps it sealed.

**Why act:false:** a deathbed will while downed is the drama; act tools are refused while downed. It is private writing, not a world order, so no rate limit (own WILL.PER_DAY 12).

Rules: companion of the same company only (issue spec; the brief also said "a person or the heir" but the issue forbids outside the company and recruits; letters cover heirs). Near = 7 tiles and same `hidden` (dungeon) -> at once; else `C.estate` until the heir rests (town rect, state town, or camp phase rest), `estateTick` in step. Gear of another class sold (SELL_VALUE), overflow stacks sold. Lapses: heir dead/left, thing no longer carried. Heir gets `h.received` (Life view), landmark k='will' (agent heirs), urgent event, chronicle line. Scripted heroes never get a.will -> hashes equal.

**How to apply:** new death-time effects belong in fall()'s hook path; check `bequeathcheck` and channelcheck's `bWill` secret.
