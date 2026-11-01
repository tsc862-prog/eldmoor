---
name: gear-and-encounter-names-review
description: Equipment materials/slot nouns (#20/#42) and road-encounter names (lanternstone shrine, Rookscar bandits, #30/#43) passed originality review 2026-11-01; notes on near-echoes and open nits
metadata:
  type: project
---

On 2026-11-01 these passed the originality check with no blocking echoes:
- Gear materials: Bramble, Oakbark, Wolfhide; Mossweave, Bogiron, Fenleather; Cinder,
  Emberforged, Ashsteel; Rime, Hoarfrost, Icevein. Slot nouns are all generic armour words.
- Road encounters: "lanternstone shrine", "Rookscar bandits" (hooded cutpurses, every zone,
  rob but never kill), wagon merchant, strongbox, lost pilgrim.

Near-echoes noted, judged acceptable: "Hoarfrost" and "Rime" appear in WoW frost item names
but are plain English; "phylactery" (Vesk's Phylactery Shard, pre-existing) is the D&D lich
term, widely reused, left alone. Suggested fallback if ever challenged: "Vesk's Soul-Jar Shard".

Nits raised (not yet confirmed fixed): pilgrim arrival line uses ". rolls N." while every
other encounter line uses "... rolls N"; LORE table mentions an unnamed "pilgrim road";
merchant text says "one gear point" which predates slot gear.

**Why:** parent asked for pass/fail per name; recording avoids re-reviewing the same names.

**How to apply:** sample Chronicle names in LORE.md (Miriel, Zugmar, Vexzar) are valid rolls
of the syllable tables in `src/data/factions.js`, not roster names; that is fine. Encounter
lines follow "<Hero> <verb>s ... on the <Zone> road... rolls N [vs DC]. <Outcome>." Keep it.
