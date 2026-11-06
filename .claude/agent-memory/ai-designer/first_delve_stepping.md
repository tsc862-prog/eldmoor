---
name: first-delve-stepping
description: #932 follow-up to the first delve - mouth must be in the gate's region and clear line, FAR 30 fallback, stepping child check, crawl lore, browser check
metadata:
  type: project
---

Delve mouths (`mouthNear` in prologue.js) now need the gate's own zone, `clearLine` from the gate, and walk out to `PRO.FAR` 30 tiles. **Why:** on the Stepping Lands Murkstead's nearest ground lay across the Greywater and Brinereach's in Sedgewater (band 4-9); Brinereach is boxed in by river and neighbours and gets its mouth 28 tiles out. A town with no mouth opens in the hall, never in a bad place.
**How to apply:** `npm run prologuecheck:stepping` (`--world stepping` sets ELDMOOR_WORLD before imports; the per-town loop runs the whole delve for every CITY row, so a new town breaks it loudly). Setup world name must be `WORLD`, not a literal.

Crawl lore (`loreRoom`/`loreMob` in crawl.js): `engage` at a room's first round for each agent crew member, `slain` on the killing blow; site species pass `v`, a room-named foe is `named`. Agent heroes only, hash-based, so seeded hashes held. Applies to every crawl, Crypt included.

`scripts/openingbrowser.mjs <url>`: headless Chrome at 3440x1440 through the real New world flow; use a fresh profile every run (a saved world puts Continue first), poll for the title button after load. Not in CI.
