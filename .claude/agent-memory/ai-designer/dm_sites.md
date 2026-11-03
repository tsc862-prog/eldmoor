---
name: dm-sites
description: #69 slice 1 - DM-made dungeon sites (sim/sites.js, data/sites.js, create_site lever + flat DM tool, enter_site); crawl generalized by g.site; rules and pitfalls
metadata:
  type: project
---

DM-made sites (#69 slice 1, 2026-11-03): `create_site` lever (levers.js stub given params; sites.js provides `createSite`), flat DM tool `create_site` (dmagent FLAT_LEVERS), hero tool `enter_site`, `S.sites` created lazily on the first pull, site marker in `S.places` (kind 'site', `until:null`, `site` id) so lore/move_to/search/survey work unchanged. Crawl.js is dungeon-agnostic: a group with `g.site` reads rooms/name/x,y from the site; scene ctx carries `site`; table.js `dunMem(ctx)` picks the group's members.

Rules and why:
- Site rooms carry `alvl` (absolute foe level, + site.grow); Crypt rooms stay party-relative (hash). Blows scale with the level gap (`hitOf`: +8%/level above, -10%/level below, .12-1.8) and a site room gets `cr.cap` rounds sized to its blows/crew, because a solo could never win a 2-round room and a level-14 solo died to a level-3 den without the gap scaling.
- Generation uses a private LCG (never gameplay RNG); limits 1 open site/region, 3/world in sites.js (not lever maxActive: sites have no expiry record), lever perDay 2, perRegionPerDay 1.
- Company entry is a council 'site' proposal (setSiteHook vote/go, NEED_ALL); passed vote sets `C.siteGo`, entry when all within 3 tiles of the mouth. Solo enters within 6 tiles.
- Crawl only when `crawlFits && companyAtTable(C)` (open() returns null for a company with no agent at the table and the crawl would stall); else the Crypt-style abstract roll.
- Import cycle: sites.js must not call provide/setSiteHook/setSiteEnd at load (TDZ on levers' `IMPL`); index.js calls `wireSites()`.
- sceneview returns null for site crawl scenes (the dungeon view only knows CRYPT). Slice 2 (raids, scripted-DM triggers, dungeon view) left as an issue.
- Lore check: place-word pairs that double a letter or name a region/town are skipped; SITE_BANNED lists famous/awkward pairs (Winterfell...).
