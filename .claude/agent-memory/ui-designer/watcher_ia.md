---
name: watcher-ia
description: Where each UI surface lives after the #145 declutter, and the one-place rules (docs/UI-PLAN.md)
metadata:
  type: project
---

The plan is in `docs/UI-PLAN.md`. As shipped:

- **Header:** title, a pitch (hidden in fellow-mode, no hard-coded counts), then the **Agents** button (limits, spend), **Settings** (vTab, vSnd, vRal, vChat World chatter, wDev Developer; a row hides when its button is hidden, via `:has`) and the clock. Popovers come from `popover()` in `src/ui/settings.js`.
- **Bar under the map:** Speed, View (map, follow, Fellowship, next, zoom), and a `World ▾` `<details id=wmenu>` with Save/Load/Export/Import/New world and the status.
- **Dossier:** three groups in `GROUPS` in panels.js: Character (stats, gear, inv, party), Story (log, bio, memory), Mind (chat, agent, mind). A new tab with no group lands in Character. `tabShown()` hides Party for Fellowship members. A group reopens on its last tab. Arrow keys move along a row.
- **One mind control:** a member's mind is set only in the Fellowship panel's "Members and minds" `<details>` (folded) and by the Minds switch for all five. The frames and the dossier header show only the label. The header's AI/Agent buttons appear for members only in Developer mode.
- **Story panel (#storySec):** titled Chronicle, or Story when a Fellowship exists, with Chronicle and Campaign log tabs. The campaign log renders into `#campaign` (fellowship.js falls back to the old details if it is missing).
- **Developer surfaces:** `body.dev-mode`. With a Fellowship, Minds at play (#mindsSec) and the relay/request stats are dev-only.

**Why:** the owner found the UI cluttered. Glance means the frames, map, header, Chronicle and clock; everything else is one click away.
