---
name: hero-purpose
description: #534 purpose line (goal → target · why) from sim/purpose.js purposeOf, on frames/dossier/map tooltip; render/purposefx.js overlays for cam.sel/cam.hover only; Intent icons switch in Settings
metadata:
  type: project
---

What a hero is trying to do (#534). One read-only helper `src/sim/purpose.js` `purposeOf(a)` -> `{kind, goal, target, why, line,
to, path, tether, wait}`; never called from step(), no RNG, so seeded hashes do not move. Agent heroes: `a.intent` (#535, read if
present: its text becomes the why), then `a.pq[0]` (move/hunt/rest/follow of #445/...), town wait for the party leader, the
adventure, then the state machine. Autopilot why = the bracketed reason of `cmd.auto`, third person ("its last order").

- UI: `src/ui/purposeview.js` (setPurpose, tapPurpose, hoverHero, renderMapTip in uiFast, setIcons). Frames' `.pfdo` and the
  dossier `.doing .purp` show the line; a tap opens a cut line (open state kept in a Set by key so the 0.3 s patch keeps it).
- Map: `src/render/purposefx.js` drawPurposeGround (under entities, sel + hover only) and drawIntentIcon (entity loop, right
  shoulder, close zoom, `cam.icons`); colours `INTENT` in palette.js. `cam.hover` set by controls.js pointermove (mouse only),
  `heroAt()` shared with the click pick.
- The Intent icons switch lives in Settings, not the View bar: uismoke caps the bar at 10 visible buttons (#145).
- Browser check gotcha: after editing a file while your own vite runs, `await import('/src/...')` in CDP can get a stale module
  instance (the app imports it with `?t=`); restart vite before poking module state.

**Why:** owner could not tell what walking/waiting/following heroes were trying to do.
**How to apply:** new "what is X doing" text goes through purposeOf, not new per-panel strings. See [[company-frames]], [[stable-panels]].
