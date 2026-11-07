---
name: map-rebind
description: Linked maps #1013 slice 1b: onWorld hooks, worded() text tables, WORDS.world stays, atlas.js tables, mapKey, the capture lint, what still breaks on a map with no lair
metadata:
  type: project
---

setWorld swaps the live map in one process. Rules added and why (#1013 slice 1b):

- A module-scope value built from the map rebuilds in `onWorld(fn, see)`; `see` returns what it keeps so crossingcheck can compare it with a fresh process. A table of text goes through `worded(()=>table)`: built again into the same objects, so `BY_NAME`-style holders of rows stay valid. String-replace of old words was rejected: on Eldmoor several WORDS share one value, so a replace cannot know which it was.
- `WORDS.world` is the campaign's name and does not change; that removed most text captures. A map with no dungeon or lair keeps the previous words.
- Scanner `scripts/mapcapture.mjs` (AST, rulescheck rule 11) is a net: member calls are not followed. It missed `NET` in traffic.js and the patch cache until the "cache filled by a map function" rule; neither was on the design's list. Allow entries also stop taint.
- `mapKey()` not plain MAP_ID: S.worldId must stay in the stamp, and a first map must keep today's value for old saves and hashes.
- core/rng.js takes Math.random at load, so a check must stub once before importing and reset the stub's seed (initcheck's way), not assign a new stub.

**Why:** the first-map hash must not move, and a real second map (Hollin, the Vale chapters) must not inherit a stale table.

**How to apply:** slice 2 packs by `MAP_KEYS`; `S.levers.day` (the DM's daily counts) must not be frozen with the map although `levers` is listed there. A map with no lair or dungeon plays since [[no_lair]]. Risk 1 count: 0 direct, 40 suspect derefs of `S.agents.find` results by a regex heuristic, mostly `byId` wrappers.

Related: [[multi_dungeon]], [[init_reset]], [[seeded_import_dice]].
