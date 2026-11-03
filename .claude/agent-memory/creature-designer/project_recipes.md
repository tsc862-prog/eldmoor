---
name: project-recipes
description: #256 recipe table design - why MATERIALS is not GOODS, crafted USES flags, bands, hash-neutral rule
metadata:
  type: project
---

One recipe table `src/data/recipes.js` (15 recipes, 3 per craft profession at bands 0/2/3 or 0/2/3 spread; #13's smith reads the same table, no second table).

- Gathered materials live in `MATERIALS` (items.js), NOT `GOODS`. **Why:** `GOODS` is walked by market decay, the DM `price_shock` pick (`ks[adv.id%ks.length]`), levers enum and the save, and `ri()` runs at import; any new GOODS row changes the seeded scripted world. `price(n)` reads GOODS then MATERIALS. **How to apply:** when #257 wires gathering, add selling and decay for MATERIALS in market.js/inv.js deliberately (hash will then change by design).
- Crafted consumables are USES rows with `craft:true`, `drop:0`, potions `tier:0` (keeps `tierId` shop ladder unchanged); `player.js` buy skips `craft` rows. Meals are kind `ration` with `buff {stat,v,mins}`; the map is kind `map` (no useItem handler yet, #258).
- Gear outputs are `CRAFT_GEAR` patterns (slot, ilvl, quality, material word); #258 builds the item with the crafter's class noun. ilvl capped per band.
- `MAT_DROPS` in bestiary.js: data only, loot.js does not read it yet.
- Proof of no behaviour change: `node scripts/recipecheck.mjs --hash` equals wakecheck/professioncheck hash on main (2554282022 / 781978456).
