---
name: ah-crafted-719
description: #719 crafted goods at the auction house - listing kind 'use', price() covers USES, tuning results
metadata:
  type: project
---
Listing kind 'use' (recipe-output consumables only) at shop price; gear keeps maker through the item object. Scripted heroes list potion surplus (keep 4) and buy potions/packs. Result: ~3 crafted listings, 0.3 sold per 120 min run; gold +4%. Little supply because scripted crafters only craft what they want (craft.js). Follow-up: market panel in ui; craft-for-market would need craft.js.
**Why:** keeps gold flat. **How to apply:** to grow volume change craft.js wants(), not market.js.
