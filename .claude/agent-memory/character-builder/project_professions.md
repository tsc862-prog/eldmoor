---
name: project-professions
description: Professions core (#254): a.profs not a.prof, API in src/sim/professions.js, 9 ids, max 2, skill 1-100, no sim hooks yet
metadata:
  type: project
---

Professions table `src/data/professions.js`, skill model `src/sim/professions.js`. Hero field is `a.profs` ([{id,skill}]) because `a.prof` already holds ability skill ids (abilities.js).

**Why:** the issue said `a.prof`; that collides, so the name differs. Field is optional and never defaulted on makeHero (heroes.js off limits), so old saves and the savecheck snapshot diff stay identical.
**How to apply:** later children (#255-#259) use professionsOf/skillOf/learn/gainSkill/skillBand; hash proof recipe is `node scripts/professioncheck.mjs --hash` (equals wakecheck --hash).
