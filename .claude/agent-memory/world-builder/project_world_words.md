---
name: world-words
description: #1003 src/world/words.js WORDS tokens fill world names into templates; worldtextcheck guards the Vale; what was left and why
metadata:
  type: project
---

`src/world/words.js` exports `WORDS` (world, crypt, cryptRegion, lairRegion, farRegion, lowRegion, midRegion, town(f)) and `worldFill`
(for `{lairRegion}`-style tokens in item flavour). Data templates interpolate it at module load (`'...'+WORDS.crypt`), so on Eldmoor every
word is the old one. Barks use a `{home}` token filled from `homeOf(a)` in chat.js.

**Why:** the Vale's heroes were told to reach the Sunken Crypt, Highgate, Thornvale. `npm run worldtextcheck` (job g7) plays the Vale and
fails on any other spec's place name in any hero or DM text.

**How to apply:** new hero- or DM-visible text takes a token, never a literal name. Import cycle trap: `data/items.js` and `data/mobs.js`
cannot import words.js (map -> fauna -> items/mobs), so their text carries `{tokens}` and the reader calls `worldFill`.
Left on purpose: item names with a place (Hoarfell Survey Chart, ids in saved packs), peoples' homeland names (Thornteeth), the
`ELITE_OPEN` zone keys (GENERIC fallback is used elsewhere), runner prompts that name "Eldmoor" as the DM's world (static in a process that
does not know the world), `PILGRIM_ZONE` as a lookup key. Vale has no `far` region flag, so no pilgrimFar oath there (adding it moves dice).
Spotted, not fixed: GOAL_DONE pilgrimFar fills `{zone}` from the numeric `g.zone`, so the completion line reads "snows of 3".
