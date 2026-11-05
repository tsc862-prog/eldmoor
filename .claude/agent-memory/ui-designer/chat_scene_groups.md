---
name: chat-scene-groups
description: #734 (PR #743) Table scenes as grouped exchanges in the Chat tab and dossier Chat; S.tableLog record, e.sk/e.opt/e.rfx line tags
metadata:
  type: project
---
Chat groups a Table scene (PR #743, issue #734): `src/ui/chatpanel.js` `scenesOf(F)` (closed scenes from `S.tableLog`, open ones from `openScenes()` + `sceneFrame`/`bannerOf`), `sceneItems` (header `sh<key>`, frame `sf`, silent act rows `sa`, result `sr`), `arrange(rows)` -> `[{it,cls,day}]` newest first with each group in reading order (`order`: lines as spoken, silent acts slotted by seat in round 1), `rowEl`. A table vote's prop/result rows join the group (cats party+table); its vote rows get `allHide` (shown under Party only). panels.js tabChat uses arrange/rowEl too; chatLine prints `e.opt` dimmed.

Sim side (write-only, hashes unchanged): table.js `sceneRecord` at the end of `outcome()`, `lineTag` in take()/voice() sets `e.sk` = `company:id`, `e.opt`, `e.rfx`.

**Why:** owner could not tell what a Table discussion was about from the members' lines alone.
**How to apply:** new scene kinds need a word in `KINDW` (else the raw kind shows); anything new written at scene close goes in `sceneRecord`, never read back by the sim. Real-browser check: CDP script with `?continue=1`, click "Play the default world", "Start anyway", then `#dock-chat` (3440 is the ultra-wide dock); use `localhost`, not 127.0.0.1, for Vite.
