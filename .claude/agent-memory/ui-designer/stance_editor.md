---
name: stance-editor
description: #316 stance-per-companion rows on the Fellowship sheet editor (ui/fellowship.js stanceBlock); why Save skips unchanged stance boxes and the sheet is no longer rebuilt on Save
metadata:
  type: project
---

#316 (UI for #305) added a "Stance toward each companion" block to the sheet editor in src/ui/fellowship.js (`stanceBlock`, `fillStance`, `refreshSheet`).

- Box value = `authoredStance(a,b)` (owner, archetype or model line); placeholder = `scriptedStance(a,b)` (the bond reading). Tag from `persona.stanceBy[id]==='owner'`, else model (src model), else archetype. Reset only on owner rows.
- Save skips stance boxes whose value equals `data-orig`: saving any other field must not turn an archetype/model line into an owner line (editSheet marks every write as owner).
- Save no longer calls `sheetView` (rebuild); it calls `refreshSheet(a,false)` in place, so scroll and focus hold. An archetype pick and Reset use `refreshSheet(a,true)` (leaves boxes with unsaved typing alone).
- An empty box with an archetype set brings back the archetype line, not the bond (sim rule in authoredStance); the hint says so.
- `.badge` is display:inline-block, so `hidden` on a badge needs `[hidden]{display:none}` in scope.

**Why:** the issue asked for owner/archetype tags and no sim change. **How to apply:** extend these rows rather than adding a second stance view (the Memory tab's Companions list is the read-only live reading with event notes).

Related: [[archetype-picker]], [[stable-panels]].
