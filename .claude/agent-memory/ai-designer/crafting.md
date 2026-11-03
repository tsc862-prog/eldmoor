---
name: crafting
description: Crafting #258 rules - craft.js where (town all, camp cooking/alchemy only), no dice, scripted townCraft buys materials, meal buff in stats.js, camp note after fireside, give to company mates
metadata:
  type: project
---

Crafting (#258, epic #238) lives in `src/sim/craft.js`. The `craft` tool is in player.js. Scripted crafting is `townCraft` in heroes.js `sellAndShop`, and it runs before the sale.

- A craft has no dice. Inside the band it always succeeds. Skill gain is 2 at the top of the band, 1 one band down, .25 lower.
  **Why:** a craft is a choice, not a gamble, and it keeps the RNG untouched for agents.
- Where you can craft:
  - A friendly town allows every recipe.
  - A camp fire in the rest phase allows only cooking and alchemy (FIRE_PROFS).
  - Crafting is refused while the company's Table scene is open (fireside or debrief).
- The camp moment is in camp.js:
  - At supper (gather -> rest), a reflexMay member runs `campCraft`, then `campMeal(a,{meals:reflexMay})`. An agent's crafted meals are never eaten for it.
  - An agent member gets one note per camp (`g.craftNote`), sent only when `!F.fireQ && !sceneFor(F)`. That puts it after the fireside, which queues on onCamp 'rest' and opens through fireTick in the same step.
- Scripted heroes:
  - From L5, a hero with a gathering trade learns the paired craft (herb->alchemy, odd-id Mage/Priest herbalists -> scribing, ore->smithing, hide->leatherworking, fish->cooking).
  - They buy missing MATERIALS at the AH, never GOODS. A consumable's cost must stay at or below 1.25x the shop price, and they keep 20g.
  - Scrolls are made only from the level restock would buy them (8 and 10). This keeps crafting from adding early escapes.
  - `keepFor` is the `sellLoot(a,hold)` param.
  **Why:** without buying, materials rarely matched the band (heroes outlevel Redroot regions). That gave 4 crafts a run. Buying gave about 59.
- The meal buff is `a.meal {id,stat,v,until gameMin}`, set by inv.js useItem. stats.js reads it through mealOf and folds it into the cache key (sig + keyOf.ml).
- give: company mates count as well as the party, hidden heroes are refused, and the range stays 4 (talk reach).
- Balance (10 seeds x120, 2026-11-03): no regression. Deaths/h 10.1 -> 11.5 (mob +2.2/run, within noise), gold -6%, levels the same. Rerun with more seeds if mob deaths climb.
- Seeded hashes moved (hash-change-ok). `npm run craftcheck` covers it. Related: [[gathering]], [[camp_rest]], [[fireside]].
