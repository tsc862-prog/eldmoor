---
name: table-combat-panel
description: #277 combat block in the Table banner (src/ui/table.js combatView), what it reads from S.table and what was left out (step/auto)
metadata:
  type: project
---

The Table banner's combat block (#277, part 2 of #140) is `combatView()` in `src/ui/table.js`: plain data that is also
the change signature, rendered by `combatBlock`/`endBlock` inside the existing `patch(box,...)`. It shows only when
`S.table.rd!=null` (combat kinds after #276); older scenes keep the plain order line.

Reads from the scene: `sc.rd`, `sc.foeAt`, `sc.fd` (foe acted this round; foe is "current" when `!fd && i>=foeAt`),
`sc.beats[].rd/res/by==='foe'`, `sc.out`, `sc.fell`, `sc.end` ('yield'/'fled'). The foe object is found by a UI copy
of table.js's private `foeOf` (ctx.mob / ctx.mobs / ctx.foe / boss). Rolls are parsed from the beat `res` text
(`rollText` format in sim/tableround.js); if that format changes, `rollOf`'s regex must follow. `sc.rl` is not usable:
flushRolls empties it at the outcome.

**Why:** the UI may not edit src/sim; bannerOf only gives the foe's name, not its HP.
**How to apply:** if sim later exports a foe getter or structured rolls on beats, switch to it and drop the regex.
"Step one round / auto-advance" from #277 was not built: it needs a sim hold, so it is a follow-up for ai-designer.
