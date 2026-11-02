---
name: dm-turn-cards
description: DM tab per-turn cards are built page-side from bridge dmcall traffic (src/ui/dmturns.js), not a sim record
metadata:
  type: project
---
Issue #181: cards in the chat panel's "DM agent" tab (Turns default, Entries behind it). Source: player-bridge.js calls noteDmCall(tool,args,result) per DM tool call; turns split on a 25 s real-time gap or a dm_status after acts; kept in localStorage per world, 40 cap. No cost per turn (needs a sim record in dmagent.js; PM said not to touch src/sim/dm*).
**How to apply:** if a sim per-turn record lands, swap dmTurns() for it and add cost/day; keep turnCard() and keys data-k="t<id>".
