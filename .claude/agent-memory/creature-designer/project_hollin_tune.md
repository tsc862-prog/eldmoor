---
name: hollin-tune
description: Hollin Reach tuning (#1013): Quarry Cellars numbers, chapter-map XP plateau, Crookjaw result, measuring tools
metadata:
  type: project
---

Quarry Cellars (spec.js QUARRY_ROOMS): cavecrawler x3 lvl+0 hit .28 / tollbreaker+cavecrawler lvl+1 hit .34 / Ruddock lvl+1 hit .44; landmark `gap:400,span:400` (sim seconds between musters, new optional dungeon fields read in `checkCrypt`; default 20+25 unchanged) and `xp:.35` (clear payout, read by crawl rooms and `payClear`). 100 reflex crawls: driven back L3 17%, L4 ~25%, L5 22%, 0 deaths (reflex play never dies here).
**Why:** foe COUNT and level offset move "driven back" far more than `hit`; hit alone barely raised it (3 crawlers + .30/.36/.42 gave 40% driven at L4).
XP plateau: `xpPlateau` in heroes.js `gainXp`, only when `LVL_CAP` finite (chapter map): one level over the cap x.17, two over x.02. Hollin heroes, scripted ones too, settle at L6-7.
Old Crookjaw (L5, 203 hp) vs a reflex Fellowship at L3/L4 in the world: 0 deaths, 0 downs in 80 fights. Not measured at a Table scene with agents.
Scratch harnesses (not committed): scripts/qtrial.mjs (crawl at fixed level), ctrial.mjs (Crookjaw), bal.mjs.
