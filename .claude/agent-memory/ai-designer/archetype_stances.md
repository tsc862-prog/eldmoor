---
name: archetype-stances
description: #305 rules for which persona stances reach Fellowship prompts (authoredStance) vs the drifting scripted bond reading
metadata:
  type: project
---

`refreshStances` (memory.js) writes `a.memory.stances`, which `fellowCard` reads first. Since #305 it takes
`authoredStance(a,b)` (persona.js) before `scriptedStance`: a model-written persona's line, an owner line
(`persona.stanceBy[id]==='owner'`, set by `editSheet(a,'stance',companionId,text)`; empty text hands it back),
or the archetype's line (the filled template; also given to a companion who joined after the archetype was set).
A shared event (`stanceEvent`) is appended to whichever line stands.

**Why:** an unedited scripted persona's `stances` are only the bond reading frozen at build time, so they must
never count as authored, or bond drift stops. `persona.edited` alone is not enough to mark a stance as the owner's
(the archetype picker sets edited for the voice fields), hence the per-companion `stanceBy` marker.
Change from before: a model stance now keeps its line with an event note instead of falling back to scripted.

**How to apply:** `applyArchetype` refreshes the member's stances at once (a runtime-only import cycle
persona.js <-> memory.js). No RNG anywhere: seeded hashes (tablecheck, crawlcheck, professioncheck) stay equal.
`npm run sim` is unseeded, so compare those hashes, not sim text. See [[party-rules]].
