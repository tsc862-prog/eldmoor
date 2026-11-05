---
name: start-heroes-know-crypt
description: #930 careerLore teaches seasoned agent starts the regions, landmarks and creatures their level has worked; raid pass/lapse words
metadata:
  type: project
---

`careerLore(a)` in lore.js (called after markPlayer in openApart) tells a seasoned agent start every region whose band low is at or under its level, landmarks and the Crypt standing in them (how 'told'), and creature names there (e.name, e.z; not seen/fought). Idempotent, no RNG, scripted heroes exempt. Together-mode starts are level 1 so need nothing.

**Why:** with #826 a solo's go_crypt is its only road to the Crypt; veterans spent their first session finding out it exists.

Raid vote: council.js carryOut now tells every member (hasLinks only) that a passed vote does not move anyone and gives the gather window; the lapse note names the likely causes. Nobody is moved by script.
