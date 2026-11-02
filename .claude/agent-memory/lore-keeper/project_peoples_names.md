---
name: project-peoples-names
description: Originality review of the six peoples (races) and reserved home towns on characters/races, 2026-11-01 - what passed, what was flagged, replacements proposed
metadata:
  type: project
---

Reviewed 2026-11-01 (characters/races branch, `src/data/races.js` + LORE "Peoples of Eldmoor"). Verdicts, pending user decision:

- Passed clean: Hallowan (soft note: WoW zone "Hallowfall" shares the Hallow- stem; Hollowmere/Hollowfang already use Hollow-), Skerrin, Ashfolk, Mirekin, Thornhide, Cairnmoot, Murkstead, Thornteeth.
- Flagged: **Carrow** (the Carrows are Harry Potter Death Eaters; Carrow Road is Norwich FC's ground) -> proposed **Tarrow**. **Saltmarsh Reach** (Saltmarsh is a canonical D&D town, U1 / Ghosts of Saltmarsh) -> proposed **Brinereach** or **Saltwick Reach**.
- Syllable collisions flagged: Hallowan El+ric=Elric (Moorcock), Gal+ion=Galion (Tolkien), Mir+iel=Miriel (Tolkien); Carrow Ulf+ric=Ulfric (Skyrim), Rhun (Tolkien Rhun); Skerrin Fin+we=Finwe (Tolkien), prefix Nance (slur risk); Ashfolk Nar+gul~Nazgul, Drak+thar~Drak'Tharon; Mirekin prefix Sseth (D&D yuan-ti god), Vel+en=Velen (WoW).

**Why:** hard rule is original IP only; people names are the most visible proper nouns after zones.
**How to apply:** if the user accepts/rejects any of the above, update this file; treat accepted names as canon when checking later PRs. Watch the Ash-/Thorn- stem overload (Ashfolk, Ashen Fist, Ash Drake, Ashsteel; Thornhide, Thornteeth, Thornvale, Thornheart).
