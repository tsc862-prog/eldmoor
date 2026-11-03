---
name: smith-upgrades
description: Issue #13 smith temper as the gold sink - formula, caps, why no repair, where it hooks
metadata:
  type: project
---

`SMITH` in `src/sim/craft.js` (not recipes.js; no new recipe rows): temper a worn non-epic piece +1 ilvl, cost `12*(ilvl+1)*rarity(plain 1, fine 1.5, rare 2.5)*(1+up*.5)`, max 3 tempers (`it.up`), cap hero lvl+2. Armor/damage recomputed via itemArmor/itemDamage; bonuses and property unchanged. Epics refused (refreshEpics already grows them). No repair: gear has no durability, `do:"repair"` returns a refusal.
Scripted: `townSmith` at the end of `sellAndShop`, keeps SMITH.KEEP 150g, 2 tempers a visit, weakest piece first, never for `a.player` heroes. Agent tool `smith {item, do}` (player.js, friendly town only).
**Why:** veterans bank thousands of unspent gold (see [[gear-slots]]). **How to apply:** to drain more gold raise PER_VISIT or MAX_UP, not the base; a temper is lost when the piece is replaced, so the sink is self-limiting.
