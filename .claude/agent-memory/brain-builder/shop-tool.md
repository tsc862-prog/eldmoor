---
name: shop-tool
description: #424 hero tool shop {npc?} - read-only stock view; how its prices are tied to buy (trader price probe), refusals, playcheck cases
metadata:
  type: project
---

`shop {npc?}` (src/sim/player.js `shopView`/`shopSlot`/`shopUse`/`traderPrice`, schema in player-tools.js) picks the
seller exactly like `buy`: npc named or out of town -> `traderFor(a,npc,PK.TALK)`; else the town smiths.

- Smith prices use buy's own sources: `USES[id].price`, `SHOP_COST(a.lvl)` (gear is always at the hero's level, plain or fine).
- Trader prices: since #425 `tradePrice(p,base)` from talk.js. (Before: `traderPrice` called `npcBuy` on a copy of the hero
  `{...a, gold:0, slots:{}, lvl}` and parses "costs Ng" from its refusal (no mutation before that check, no RNG).
  - done, see [[inspect-tool]].)
- Gear change = plain `itemArmor/itemDamage(cls,slot,lvl)` minus the worn piece's `itemStats` armor/damage.
- Out of town with no npc: "The smiths are in town. <home> lies <dir>, about N tiles (time): move_to {target: "home"}"
  plus the trader's refusal when one is open but far.
- playcheck cases: shop changes nothing, needs level N, head price == buy cost, Redroot x2 cost, shop {npc} == npcBuy
  cost, outside-town refusal. Seeded hash unchanged (fellowship=true 1733832012).

Pitfall: a single quote inside a player-tools.js desc must be avoided (heredoc edits drop the backslash). Related: [[places-tool]], [[give-by-name]].
