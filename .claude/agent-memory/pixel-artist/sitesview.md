---
name: site-dungeon-view
description: #642 dungeon view for DM-made sites (render/siteview.js themes, keys per dungeon, staging a site crawl shot)
metadata:
  type: project
---
- DM-made sites (sim/sites.js, S.sites.list) open the same dungeon view as the Crypt. render/siteview.js dresses
  world/interior.js buildInterior(site) per theme (palette.js THEMES 'site-<theme>', props in render/siteprops.js,
  room kind from the room id). dungeonview tracks every dungeon by keyOf (Crypt name or 'site:<id>') and looks a site up
  fresh each frame (siteById), since a restore replaces the objects. data-dungeon="site:<id>" opens one.
- **Why:** sites are not landmarks: no mouth, group lives on the site, the list object changes on load.
- **How to apply:** stage a shot with ctl.speed=0, S.sites=undefined, sites.createSite({theme,region:1,rooms:6},{by,reason,id:1}),
  then s.group={site:s.id,mem:slotHeroes(slotted()),phase:'inside',tSite:1,crawl:{i,rd,gap:0,foes:[{type,hp,hits,lvl}],end:null,co:C.id,...}}
  and openDungeon(s). slotMembers returns {slot,hero} rows; use slotHeroes. The top-right floor tile of a chamber carries
  the cleared badge; keep props off it. A page that reloads mid-staging (vite HMR after an edit) draws nothing: rerun.
  See [[dungeon-view]], [[previews]].
- #678 polish: temple pillar is SITEP.sitepillar (theme stone); interior.js roomEdge outlines only floor edges; wall-tile lights are clipped to their row. Staging gotcha: in headless Chrome the page's rAF loop may leave the dungeon canvas blank, so call dungeonview.drawDungeon(now) via CDP right before Page.captureScreenshot.
