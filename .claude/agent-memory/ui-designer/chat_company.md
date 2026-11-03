---
name: chat-company
description: #506 shouts in the Chat panel name their company when 2+ companies exist
metadata:
  type: project
---

chatpanel.js `shoutLine(e)` wraps panels.chatLine and inserts a dim ` (Company)` span after the name; `shoutCompany(e)` returns '' with one company, for aloud lines, couriers and the Narrator. The panel signature includes company ids and labels so a rename or a new company repaints. The dossier Chat tab is unchanged (it uses chatLine directly). Stub DOM lacks `after()`; use insertBefore.
