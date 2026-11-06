---
name: vale-fauna
description: Wending Vale bestiary (#945, epic #940 D): per-region species, art constraint, what the sims showed
metadata:
  type: project
---

FAUNA entries in src/data/fauna.js accept objects {sp,name,pl,lv,loot,q}; Vale goods are VALE_GOODS, added to GOODS at world build only (adding to GOODS at import shifts import dice and every Eldmoor hash). Elite `fixLvl` overrides the hi+2 level without touching Stepping.

**Art constraint:** only wolf, boar, mudboar, spider, lurker, bog, golem, wight, rimehound have LPC art (PR #853); no drake or shaghorn. But sprites.js looks art up by exact MOBS key (MOB_ID[e.type]) so `wolf@0` clones fall back to the old look until it uses baseId(e.type): a render fix owed to pixel-artist.

**Tuning:** Sallowfen and Hawkwold hold home towns, so their lows sit at 2-4 (not the band's 3): the first pass (lows 5-6) killed L1-3 recruits (47 of 64 mob deaths). After: mob deaths per 120 min 10.7 -> 5, L<=5 deaths 8.5 -> 4. Deaths/h then ~10 (under 12-20; the shortfall is the missing early deaths). Boss rooms rounds 3-4, other 4-blow rooms 3.

**Open:** gen.js makes only the first crypt landmark live, so Kestrel Barrow, Sallow Vaults and Brandwright Kiln are never entered in play (world-builder / ai-designer). Weir, Kestrel, Vaults are ~100% clear at entry-1 (too easy); Kiln drives back 12-20%.
