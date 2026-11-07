---
name: no-lair
description: Maps with no lair or dungeon (#1013): crypts.js and lair.js are the only readers, dormant boss must not wake, words at boot, TESTBARE fixtures, rule 12, thrown errors hide behind sentences
metadata:
  type: project
---

A map may have no lair and no dungeon (the owner's starter map has neither raid nor great dungeon). Rules added and why:

- `CRYPT`/`LAIR` are read through `sim/crypts.js` and `sim/lair.js`. rulescheck rule 12 counts what does not: a member read, a member of `x||CRYPT`, or the name handed to a call (`dist(p,LAIR)` was the camp.js crash, and it is not a dot read). `const D=CRYPT; D.x` is out of its reach: a net, not a proof.
- `updBoss` must return on a map with no lair: a dormant `S.boss` (alive false, respawn 0) otherwise woke on the first tick. `Kragmaw alive: false` in `npm run sim` is the tell.
- Crypt and raid doors refuse in words (`NO_CRYPT`, `NO_LAIR`) at `propose`, `pickCrypt` (so `go_crypt` and the propose tool), `join_raid`, `callRefusal`. Guild focus never offers Delve or Wyrmhunt where the place is missing.
- Oaths to a far dungeon or Kragmaw still roll on such a map: they are out there, on a map not yet reached. `goalPoint` gives null, so a pilgrim just does not walk.
- `WORDS` at boot gets far-place defaults, because `mapWords()` leaves crypt and lair words out of a map with none, and a world that starts there has no previous words: templates read "undefined".
- A site is the only dungeon on such a map: `cryptOfCtx(ctx).group` crashed at a site's stair scene, so use `cryptGroupOf`.

**Why:** a first map with no lair must boot and play, and the seeded hashes of every other world must not move.

**How to apply:** `ELDMOOR_WORLD=testbare|testcellar|testden` boots the TESTBARE fixtures (`pickWorld` accepts all of `MAPS`). In a check, `playerAct` and `dmAct` turn a TypeError into a sentence ("The world did not understand that", "The DM tool failed"): test for those, an `ok:false` alone proves nothing. Hero and DM read tools are looped in crossingcheck `--bare`, which found `musterWord` and the call_to line, neither a bare read.

Render and the page were read, not run, on these maps.

Related: [[map_rebind]], [[multi_dungeon]].
