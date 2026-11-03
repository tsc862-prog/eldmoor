---
name: skald-gear
description: Skald gear nouns and armour weight (#274): row in items.js SLOT_NOUNS/ARMOR_CLASS/WEAPON_SLOTS
metadata:
  type: project
---

Skald gear (#274): nouns Cap, Doublet, Bracers, Marchboots, Warhorn (main), Songstone (off), Lutecharm; ARMOR_CLASS .25; WEAPON_SLOTS main 1. Canon in docs/LORE.md under Skald.

**Why:** the Skald fell back to Warrior nouns and armour weight .3 (needed light gear like a Rogue).
**How to apply:** a new class needs rows in all three tables in src/data/items.js (SLOT_NOUNS, ARMOR_CLASS, WEAPON_SLOTS), else it falls back to Warrior nouns. Wildspeaker still has no row (not in #274 scope).
