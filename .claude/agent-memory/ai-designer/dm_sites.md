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

Slice 2 (#642, 2026-11-03):
- Raid sites (create_site raid:true; flat tool raid:"yes"): band defaults to max(lo+1, RAID_LVL); boss hits x2, 4 rounds, phases in SITE.PHASES (crawl reads f.ph in hitOf, set by sites.js bossPhase; the abstract roll logs the phases reached and loses more the deeper it got). Size rule is boss.js raidSized (5, or 4 with gear 9+), shared with raidCheck. A kill -> state 'locked' LOCK_DAYS (counts as open for the caps, not enterable), then reopen; RAID_KILLS kills -> ruin. A company short of a raid goes down with another company that voted for the same site (siteGo) or calls background fill-ins (a.siteFill, they walk via a.siteAt); the first company is the crawl's crew, the rest ride along.
- Background parties (bgMuster, every MUSTER s): discovered sites only, never one near a company, one a company voted for, or a DM-agent site younger than BG_AFTER days (companies first); a gathering party yields to a company at the mouth. Ordinary sites take only heroes at the band's top or above and lose at BG_LOST .25: the first balance pass (any level >= band-1, LOST .4, scripted P .4) put background deaths +3.4/h over main; after the tune -0.7/h. Party followers ('follow' state) never muster; fixtures must leaveParty.
- Scripted DM (dm.js raiseSite): successful clear/relic (adv.id hash, P .3) and migration/invasion events. dm.js cannot import sites.js (crawl.js TDZ on setCrawlHook) -> index.js injects siteRoom via setSiteRoom. Its sites start discovered (the finder named) or nobody would ever find them off the roads.
- Raid kills stay rare in npm run sim (~0.1/run): background raiders need 4-8 free heroes of one side within RAID_CALL 44.
- Links: parts {t,c:'gd',dg:'site:<id>'} (siteTag) open the dungeon view from the hero Log (ui/panels.js parts); timeline entries kind 'site' carry e.site.
