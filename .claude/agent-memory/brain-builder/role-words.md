---
name: role-words
description: #863 placeWord(cls) in company.js: heroes and the DM name their place by class, never Tank/Healer/Damage; check lives in personacheck
metadata:
  type: project
---

`placeWord(cls)` (company.js) is the one word a character uses for its place: the lowercased class ("its priest"). Used by fellowCard/factsOf/compOf/backstory `joined` (persona.js), join/death memory, record and campaign lines (company.js), arrival ctx.role, `look`'s fellowship tag (now just "of the Fellowship"), and the DM's member views (`seatWord` in dmagent.js; empty places list the classes that fit).
Owner UI keeps Tank/Healer/DPS (ROLE_NAME, SLOTS label). No hash moved (hashcheck equal to main).
**How to apply:** any new hero- or DM-facing text about a company place uses placeWord; personacheck "role words" greps hero text for the bare terms.
