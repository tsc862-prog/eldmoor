---
name: chatter-rules
description: Hero chatter (issue #21) design rules - why say() lives in chat.js with lazy per-hero fields, a private RNG, 2+ level spot threshold, and how shared-file edits were kept merge-safe
metadata:
  type: project
---

Chatter is purely cosmetic: `say()` in `src/sim/chat.js` rolls its own LCG so line picking never
touches the gameplay `Math.random` stream, and per-hero fields (`chat`, `chatCd`, `bubble`,
`spotTgt`, `duelFoe`) are created lazily in chat.js rather than in `makeHero`.

**Why:** issue #21 was built in parallel with the weather (world-builder) and traits
(character-builder) branches, which edit `moveTo`, `findMob`, the hunt go-home check, pvp
distances and the caution constants in heroes.js/pvp.js. Keeping every heroes.js change to an
inserted `say(...)`/`spotMob(...)` line on its own line (and the dedupe logic in chat.js wrappers)
kept the three branches mergeable. Deaths per hour must be unchanged by chatter (measured 47/46/47
before vs 44/48/47 after).

**How to apply:** new barks go in `src/data/barks.js` (lore-keeper owns the voice; Concord formal
and dry, Warband blunt and boastful; nothing from existing games). New triggers: insert one line
at the state transition, never conditions inside existing one-liners. `spot` fires only for mobs
2+ levels above (or elites) because `findMob` caps solo targets at lvl+1; at 1+ it was 58% of all
lines. Bubble text wraps to 3 lines of 20 chars, so keep lines under ~58 chars including the
longest mob name ("Bristleback Boar"). Watch the `pvpCheck` duel one-liners: duel barks are
hooked by a separate `duelBark` pass after the duel loop rather than inside it.
