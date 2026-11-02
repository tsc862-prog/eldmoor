---
name: table-items
description: Issue #360 rules for using a pack item (potion, antidote, scroll) as a Table round act: use:<slug> keys, when each is offered, no reflex change, logging
metadata:
  type: project
---

A Table combat scene offers `use:<item slug>` options (tableround.js `useOptions`, wired in table.js `baseOptions`), one per
consumable the member carries that would do something now. Bandage, ration, torch and pack are never offered (inv.js refuses
bandages/rations in a fight; torches are camp-only). Potion: yourself if hurt, else the hurt companion `lowest()` names, but
only when both share `a.party` (inv.js useItem refuses otherwise: "Only a party member can be tended"). Antidote: when
venomOn or the round's `poison` condition holds (condition-only poison is cured by endCond + take + actItem, since useItem
only knows creature venom). Ward scroll: while no `wardT`. Recall scroll: in useItem's recall states and not rooted; it puts the
member in `sc.out` like a retreat.

**Why:** issue #360 (from #140): items as a round action through the existing useItem, no new RNG, scripted world unchanged.

**How to apply:**
- sceneAct accepts `use:<Item Name>` (slugged) and a bare `use` (the first item offered).
- The beat carries `use: {item, on, ok, effect, healed?}` (via `sc.ru`, cleared in take() like `sc.rr`/`sc.rc`); the DM log
  rounds entry gets a `kind:'use'` line ("X uses Item (+N health)"). The old `potion` option also writes that line now.
- reflexFor was NOT changed: reflex never picks `use:`; its existing order (potion below 35% first, then class heal, then
  plain heal) is from before #347 and was left alone. If a reflex item is ever added, keep class heal before potion.
- Test: `node scripts/tablecheck.mjs --use` (child world; ends "USE OK").

Related: [[table-rounds]], [[table-conditions]], [[reflex-moves]]
