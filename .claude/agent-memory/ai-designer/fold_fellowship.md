---
name: fold-fellowship
description: #588 folding the Fellowship into companies - slot model moved to company.js (slots option), shim names in fellowship.js, step plan and hash proof
metadata:
  type: project
---

Issue #588 (epic #402, after #460/PR #587): the five-slot model leaves `fellowship.js` for `company.js` in steps,
each hash-identical (`npm run hashcheck` compares with origin/main itself).

Step 1 (branch ai/fold-fellowship): every slot function now lives in `company.js` and takes the company as its first
argument: `slotMembers(C)`, `slotHeroes(C)` (living, slot order), `slotParty(C)`, `slotKeyOf(a)`, `slotLabel(a)`,
`inSlots(a)`, `partySlotted(p)`, `wasSlotted`, `campaignBy(C,...)`, `foundSlots`, `joinSlot(C,a,key)`,
`leaveSlot(C,a)`, `offerReplacement(C,key)`, `seatRecruit(C,q)`, `enrich(C,a)`, `setSlotMinds`, `enforceAgents(C)`,
`disbandSlots(C)`, `slotsTick(dt)`, `chronicleFocus(e,C=slotted())`, `editSheet(...,F=slotted())`, `companyName`.
`slotted()` = the company with slots (what `S.fellowship` returns). `fellowship.js` is now only one-line wrappers that
pass `slotted()`, so every old import keeps working.

Rules chosen and why:
- **New code never reads the shims** (`a.fellow`, `a.fellowRole`, `p.fellow`, `S.fellowship`): use `inSlots`,
  `slotKeyOf`, `partySlotted`, `slotted()`; otherwise the shims can never be deleted.
- **`slotHeroes(C)` is not `members(C)`**: members follow `C.ids`; slot readers must follow `C.slots` (a merge could
  add non-slot ids). Same result today, different once companies change shape.
- **Import graph**: company.js now imports heroes/player/brain/memory/persona; the load order still keeps tiers.js's
  onRecord listener ahead of the slot record hook (memory.js imports tiers.js), and memory.js finishes before
  `setSummariser` runs. A hash change after moving code between modules: suspect listener order first.

**How to apply:** step 2 converts readers module by module (sim first, then render/ui, then scripts: scripts hold
most of the ~600 `fellows()`/`S.fellowship` uses), step 3 deletes `fellowship.js` and the accessors (save.js must then
stop expecting them; old saves already carry only `S.companies`/`a.company`).
