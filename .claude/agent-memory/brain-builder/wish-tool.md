---
name: wish-tool
description: #663 wish {tool,what,why,moment} on both seats - wish.js, outbox -> watch -> wishes.jsonl, save fields, report section, pitfalls
metadata:
  type: project
---

`src/sim/wish.js` `fileWish(holder, who, args)`: hero keeps `a.wishes`/`a.wishDay`, DM keeps `S.dmAgent.wishes`; `WISH.PER_DAY` 3 per seat, KEEP 20, English only, all four fields required. act:false rows in player-tools and dm-tools; `T.wish` in player.js, `case 'wish'` in dmagent.js.
File path: wish.js module-level outbox (`takeWishes`, cap 200) is drained by `makeWatch().tick()` (`kind:'wish'`, also new `S.rulings.past` entries as `type:'attempt'`, past now carries `skill`). Page sends it over the bridge, play-headless via `play.behaviorIngest`; `attachPlay`'s `behaviorIngest` stamps provider/model from the seat's claim. `behavior.ingest('wish')` writes `wishes.jsonl`. `--no-behavior` = no watch/log, save unchanged.
Report: `wishSection`/`wishData` in behavior-report.mjs (group by `wishKey`, best = most words, unknown tools from turn-line errors, attempts by skill and first verb); `--all` also writes `wishes-all.md`.
Orders: `WISH_ORDERS` (agent-player, added by `withMemoryOrders`) and `DM_WISH_ORDERS`/`withDmWishOrders` (dm-agent).

**Pitfall:** my shell tool halves backslashes in commands (`'\n'` arrives as `'\n'`), so Python patch scripts that write JS escapes silently produce real newlines; use the Edit tool for lines with `\n`. Also hashcheck "moved" once only because origin/main advanced after my fetch: fetch + merge, then rerun.
