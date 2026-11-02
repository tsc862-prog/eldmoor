---
name: conditions-panel
description: #366 Region conditions world panel (src/ui/conditions.js), mounted from JS by layout.js, Fellowship road first
metadata:
  type: project
---

`src/ui/conditions.js` lists `S.conditions` (set_condition and start_event both write there) in a section it creates
itself (`#condSec`, data-o 2.5, data-world 1.5, so it sits after Factions both with and without a Fellowship).
`applyLayout()` calls `mountConditions()` + `renderConditions()` each fast tick; a text signature skips the patch.
Who started it comes from the lever record (`S.levers.active` by `c.lever`), event kind from `rec.params.kind`
(invasion shows as Invasion though the condition kind is bandits). Road = `focus().zones` + `focus().zone` + each
living member's `zoneAt`.

**Why:** the caller limited the PR to conditions.js, layout.js and style.css, so no index.html section and no app.js hook.

**How to apply:** if index.html or app.js are touched later, the section and render call can move there; uismoke's
"conditions:" block injects fake conditions plus a fake lever record and restores them.
