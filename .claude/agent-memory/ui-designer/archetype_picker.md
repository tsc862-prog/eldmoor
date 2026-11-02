---
name: archetype-picker
description: Persona archetype pickers (#295 follow-up) on the setup cards and the Fellowship sheet editor; stance fill rule; why the editor marks the persona edited
metadata:
  type: project
---

Archetype pickers shipped on branch ui/archetype-picker (follow-up to #295, PR #298).

- Setup: `slots[k].archetype` = id | 'random' | absent; `resolveArchetype(setup,k)` in sim/setup.js picks Random with `hash(slot+1,295,seed)` (no RNG); applied inside `applyMinds` after `found()` so the personas and all mates exist.
- Sheet editor (ui/fellowship.js `archRow`/`pickArchetype`): the change listener applies it, then calls `editSheet(...,'voice',...)` only to set `persona.edited`, because relay enrichment replaces any persona that is not model-written or edited. The five persona textareas are updated in place, never rebuilt.
- Stance fill rule in `applyArchetype(a,id,mates?)`: replace a stance when missing, when the persona is unedited scripted, when it equals `scriptedStance` now, or the previous archetype's line. Scripted stances drift with bonds, so comparing against `scriptedStance` alone was flaky in uismoke.

**Why:** memory.js `refreshStances` only reads `persona.stances` for `src:'model'` personas, so the archetype stance shows on the sheet but prompts still use the scripted bond reading (ai-designer's call to change).
**How to apply:** if asked why the archetype stance never reaches a prompt, point at refreshStances in src/sim/memory.js.
