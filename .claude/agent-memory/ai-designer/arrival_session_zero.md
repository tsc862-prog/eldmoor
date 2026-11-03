---
name: arrival-session-zero
description: #452/#437 arrival and opening Table scenes plus the DM prep - gated on hasLinks (hash-safe), prep caps, newcomer voiced by the DM, letters per company, check pitfalls
metadata:
  type: project
---

Issues #452 (epic #402 slice 15) and #437 share one mechanism: `src/sim/arrival.js` registers scene kinds `opening` and
`arrival` (PLAY 'all') with their own DM call hooks (`setSceneKind(k,{...,dm:{onFrame,onAll,live,fill,done}})`; table.js
`dmOf(sc)` prefers a kind's hooks over the staged ones). `src/sim/prep.js` holds the DM prep (not saved, real time).

Rules chosen and why:
- **Everything is gated on `hasLinks()`** (a host reports runner links: the page, play-headless). npm run sim and the
  checks replace the fallen at once as before and never open an opening, so every seeded hash stayed identical
  (professioncheck 2890548967/1733832012, tablecheck 1607308129 / talk -1443423032, crawlcheck -1550190454, focuscheck
  1606329989). Any in-process check that called `localBackend()`/`setRunnerLinks` is now "hosted": a Fellowship death
  there waits for an arrival scene (channelcheck needed its members brought home to fill the seat).
- **The newcomer is not in sc.ids** (`ctx.skip`): the DM voices them (owner decision 5); a just-made agent hero has no
  runner yet. Made and seated when the scene opens (`seatRecruit`), placed at the town gate or joined to the camp's ids.
- **Reserve the S.recruits entry at the death** or the step's background recruit of that class is made too.
- **Prep host flag**: `setPrepHost(true)` (rungate init, play-headless --wait-ready); a DM runner waits for a prep only
  when dm_status prep.host says one will come, else dmcheck's runners would idle 15 s.
- **Prep trigger** = a new DM readiness record (JSON of dm.ready) once all seats are ready: covers new world (full, opening
  due), Continue and a restarted DM runner (short); the probe's READY stand-in never triggers (uismoke's older gate tests).
- Letters are per company keyed by writer (`C.letters`), created only when a letter is sealed (an empty map broke
  savecheck's v6/v7 deep-equal); delivery: succeeds/slot, then same class, then anyone after LETTER_DAYS.
- A solo's heir needs the dead solo's runner to have been live at death (playcheck's solos stay as before).

Pitfalls: scenes stay in phase 'frame' for TABLE.frameS before onFrame pushes the DM call, so tests poll table_call
through the frame; a live agent that never answers holds an 'all' scene for TABLE.liveMs of sim time.

**How to apply:** new scene kinds that need the DM's voice should bring their own `dm` hooks rather than faking
ctx.staged. Related: [[table-simultaneous]], [[company-model]], [[emergent-parties]], [[new-world-setup]].
