---
name: dm-undo-flat
description: #636 DM undo/dismiss/unstage and ten more flat lever tools; D.last, takeBack/TAKE_BACK in levers.js, unstage in staged.js, caps, test pitfalls
metadata:
  type: project
---

#636: the rest of the levers are flat DM tools (`retire_person`, `withdraw_hook`, `set_attitude`, `set_condition`, `price_shock`, `mark_danger` (+`cleared:"yes"` -> mark_cleared), `start_event`, `nudge_relation`, `custom_foe`, `create_site`), built by `flatMore()` in `src/sim/dmagent.js` and sent through `pullLever(a, via)`, so daily pull cap, pile-on, limits, Fellowship reserve and the DM log are the lever path's. `FLAT_LEVERS` maps tool to lever; `MORE_FLAT`/`MORE_USAGE()` hold the contracts. `retire_person {how}` writes a chronicle line "<name> <how>." (via.after); `set_attitude {to}` reads a hero, "fellowship" (leader's party) or a faction name.

Taking back: `undo`, `dismiss`, `unstage` share `DMA.UNDOS_PER_DAY` 6 (`day.undos`), need a reason, log with `detail.lever` = the tool name and `detail.undid` = what ended. `undo` reaches only `D.last` (the last successful pull or stage_scene, `DMA.UNDO_MIN` 180 game min): post_hook -> withdraw_hook pull (refused once a hero took it), `TAKE_BACK` levers (mark_place, mark_dangerous/cleared, set_condition, set_attitude, create_npc, custom_foe) -> `takeBack(id)` in `levers.js` (ends the active record, so the lever's own `expire` runs; refuses a custom_foe already in a fight and a person bound to a staged scene), a stage -> `unstage()` in `staged.js` (refused once phase is not `waiting`; cast mobs gone, person and mystery marker taken down; the day's staged count is NOT refunded). Prices, items, relations, events and sites cannot be undone. `dismiss` only touches things whose active record has `by:'dm-agent'`.

**Why:** the DM looped on "one staged scene still pending" and had no way to cancel what it started.

**How to apply / pitfalls:**
- `detail` spread after `lever:` overwrote the tool name once; keep `lever` = tool and put the target in `undid`.
- dmcheck: the staging tests burn the 3-a-day staged cap, so reset `S.staged.day` at the end of any block that stages; `start_event` leaves an active record (not undoable) and a condition, so clear `S.levers.active` and `S.conditions` between tests; pick a region with no condition.
- Two old tests called `set_condition` as an unknown tool (dmcheck, localcheck); they now use `mark_cleared`, which is still pull_lever-only.
- DM orders: `DM_BETWEEN_ORDERS` in `scripts/dm-agent.mjs` (+ `withDmBetweenOrders` for older sessions); dmcheck asserts every new tool name is in `dmSystemPrompt`.
- Hashes unchanged (`npm run hashcheck`); `D.last` is created lazily only on a DM call.
