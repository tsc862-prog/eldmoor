---
name: project-market-crafters
description: #783/PR #889 marketCraft design, levers and balance result
metadata:
  type: project
---
marketCraft (craft.js, called from townCraft) crafts one consumable per visit when fewer than CRAFT.MARKET_LOW (2) units are listed and cost <= MARKET_X (.7) of shop price, then lists it at once at shop price. scriptedBuy also buys listed meals (eaten) and scrolls (SCROLL_LVL, exported from market.js).

**Why:** crafted listings sold ~0.3 a run after #782. **Result:** gold 612 vs 589 (noise), consumable sales only 5.6 -> 7.8 a run; most new listings lapse. Levers if it must matter: MARKET_LOW, MARKET_X, MARKET_PER_VISIT.
**How to apply:** hashcheck vs origin/main moves only because main lacks #782; against the PR parent hashes are equal (600 s probes are blind: crafting starts at L5). No hash-change-ok needed. Watcher listings view not done (ui-designer).
