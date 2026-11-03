---
name: hero-trades
description: #14 hero-to-hero auction order book in market.js: S.listings, fee, lapse, scripted buy/sell rules, agent tools
metadata:
  type: project
---

Order book `S.listings` in `src/sim/market.js` (TRADE table: 5% fee gold sink, 3-day lapse, gear ask 2x SELL_VALUE, ask bounds .5x-2.5x, 4 listings a hero, RESERVE 80g). `S.trades` (last 20) and `S.tradeStats` feed the Trades line in headless.mjs.
Scripted heroes in `sellAndShop`: buy (gear upgrade of 2+ ilvl, or recipe materials) before autoEquip, list non-kept spare gear before sellLoot. Lapsed scripted gear pays SELL_VALUE (same as the old house sale); an agent's returns to its pack.
Agent tools: auction_browse/list/buy/cancel. Price shocks reuse the existing `price_shock` lever (not changed). Not done: AH panel UI (ui-designer), crafting demand feeding supply.
**Why:** the old AH was a price list. **How to apply:** goods listings come only from agents; scripted heroes sell goods to the house as before.
