---
name: downed-ui
description: #659 watcher side of the death system - src/ui/downview.js (downView, trackDowned flash, downPurpose, downKind, downTimeline), frames/hero card/banner/timeline wiring
metadata:
  type: project
---

#659 (epic #626) put the downed on screen. One helper, `src/ui/downview.js`, is read by frames, the dossier header, purposeview, sheet, table banner and timeline.

- The sim keeps only the tally (`a.down` s, f, stable, next, wake, by). No die is stored for a save in the world, so `trackDowned()` (first call in `uiFast`) compares each tick and flashes SAVED / FAILED / STRUCK / STABLE / UP / DIED for 4 s. A save moves `d.next`; a blow on the downed does not, which is how STRUCK is told apart from FAILED.
- `failsOf(a)` is a read-only export added to `src/sim/downed.js` (4 failures with a healer near).
- `purposeFor(a)` in purposeview = `downPurpose(a) || purposeOf(a)`: "Bleeding out → downed by X · Y is coming", or "Tending X · who lies dying".
- Timeline downings are not on `S.timeline` (that would be a sim change). `downTimeline()` reads the heroes' Log lines (company members and level 10+), keyed by the Log entry object, and merges them by game minute. There is a "Downed" filter.
- Banner: it is built against #698's beat shape (`check.kind==='death'`, with s, f, of). On main nobody is downed at a table, so the banner part only shows in uismoke and the fake-scene browser shot.
- Mercy and finish regexes in `downKind` wait for #657's real wording; check them when it lands.

**Why:** the brief said UI only and hashes equal, so everything is derived on the page.
**How to apply:** when #655/#656/#657 land (Watch clock, wounds, spare), extend downview.js. Do not add a second view of the same data. Browser checks can import `/src/sim/*.js` from the page on a vite dev port, which gives the same module instances.
