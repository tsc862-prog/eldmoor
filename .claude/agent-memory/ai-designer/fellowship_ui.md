---
name: fellowship-ui
description: Fellowship-first UI rules (#94) - who gets AI/Agent controls, how per-member minds are marked, layout switch by DOM moves
metadata:
  type: project
---

With a Fellowship, AI/Agent control belongs to its members only (owner direction on #94, 2026-11-01). Non-members' hero-card buttons hide unless the viewer's "Developer" toggle (localStorage `eldmoor.dev`) is on.

**Why:** the owner wants the screen organised around the five; minds for random heroes are a testing tool.

**How to apply:**
- Per-member mind switches (frames, roster) set `a.fellowBrain` / `a.fellowAgent` exactly like `setMinds`, so `leave()` hands the hero back to scripted. Any new mind control must do the same.
- The layout switch moves existing panel nodes (data-o / data-world in index.html) rather than rebuilding, so listeners and open state survive. A new world panel needs both attributes.
- Fellowship slot changes are instant on death (offerReplacement runs in onDeath), so the "dead" state the UI can show is usually "replaced"; read `F.past` for the previous holder.
- Related: [[party-rules]].

#114: each member appears once with live stats, in the party frames. The Fellowship panel's roster is now a settings list (renderSettings: role chip, name, Sheet, Remove, Fill/Add, mind row), no level/HP/status. Chose a panel list over a per-frame gear popover: the mind row's selects would be lost to the frames' 0.3 s re-render in a popover, and frames.js stays untouched. Frames' cycle button and the mind row both set fellowBrain/fellowAgent.
