---
name: project-outposts
description: Contested outposts (#11): spec data, control model in sim/outposts.js, tuning and the Fellowship-death flag
metadata:
  type: project
---
Outposts are `spec.outposts` (Fenmarch Cross at the Mirefen crossroads, Ashgate Watch on the Cinderpass lair road); gen.js derives OUTPOSTS, nothing is painted so the map hash is unchanged. Control `ctl` -100..100 in `S.outposts` (src/sim/outposts.js); hold set at +-100, dropped on crossing zero. Holder gets a rest aura; kills within r+2 give double honor; scripted heroes use `outpostDest` (hash based, no RNG draws); agents have the `outposts` tool and move_to by name.
**Why:** Fellowship deaths rose (1.7 vs 0.5 per run at RATE 2/GO_P .25; still ~1.5 at RATE 1/GO_P .1, n=6) - the crossroads sits on every road, so enemies gather where the Fellowship passes. PR left without auto-merge.
**How to apply:** if retuning, consider moving Fenmarch Cross off the road junction or dropping the aura. dmcheck is seed-brittle (fixed a Crypt-spot fixture in --fairness; pairFits flips with any sim change).
