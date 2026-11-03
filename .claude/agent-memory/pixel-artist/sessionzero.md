---
name: session-zero-room
description: #701 opening/arrival scenes play indoors via ctx.setting; townsfolk home column cause; staging recipe
metadata:
  type: project
---
- sceneview ROOM_KINDS (opening, arrival) play indoors only when arrival.js put ctx.setting (tavern) in; camp arrivals keep the cut.
- NPC pile: sim/npcs.js homeAt puts residents on one wall column 1 tile apart; draw.js now lane-staggers idle 'home' npcs (render only).
- S.npcs is undefined until ensureNpcs() runs (a held world never ticks); call it before staging. openScene is exported from sim/table.js.
