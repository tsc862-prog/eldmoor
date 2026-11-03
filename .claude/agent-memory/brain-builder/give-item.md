---
name: give-item
description: #524 give_item/take_item DM levers: item resolution, rules, token fold-in, flat tools, test pitfalls
metadata:
  type: project
---

`give_item {hero, item, by?, ilvl?}` / `take_item {hero, item, by?}` in `src/sim/levers.js` (perDay 4 each; gear 1 a day via `LK.GEAR_PER_DAY`, `today().n.give_item_gear`). `item` text resolves (itemOf) to a QUEST_ITEMS id, a USES id, or a slot name (plain gear via makeItem, quality plain, never epic, ilvl <= hero lvl). `by` = npc id within `LK.EAR` 7 tiles. Refused: fight states, unknown id, epic/GOODS names, full pack, already carries, take of gear/consumables. Event is `notify(a, line, 1)` + `record`.

- `register()` forbids a param named `item`; levers opt out with `allow:['item']`. A param named `lvl` is forbidden by levercheck's regex too, hence `ilvl`.
- give_token/take_token are not registered any more: `pull()` and dmagent `pullLever` alias them (`leverAlias`, `aliasParams`, token -> item).
- Flat DM tools give_item/take_item in `FLAT_LEVERS` (dmagent.js) resolve hero/by by name via heroOf/personOf. The `case` list in the tool switch needs the names too (missing it gives "no answer").
- Pitfalls: apostrophes in dm-tools.js strings (use a curly one); dmcheck must reset `S.levers.day.n/nf/rz` field-wise, not `day = {}`; gear counts toward the world share (3 of 4 before the Fellowship reserve), so reset the day between tests.
- Not done: marking a #545 scene prop as given (that PR was not merged).
