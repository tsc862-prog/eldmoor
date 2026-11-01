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
