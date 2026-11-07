---
name: company-party-keeps
description: "#1048: with a host a company's party never ends on a town walk; keeps(p) gate, comeIn, muster forms up anywhere, lead_to for any company, C.road walk label"
metadata:
  type: project
---

With a host (`hasLinks`) a company's party is the company walking, not a trip out (`keeps(p)` in party.js). No host keeps the old rule, so every seeded hash stayed equal.

**Why:** every walk to a town goes by a `return` leg, which set `p.home`, so the party ended at any town on any map; idle members left on autopilot before `muster` saw two in town, and `muster` only formed in town. Then `lead_to` refused. Also `p.home` let one fleeing member turn the whole company round, which is an agent's decision.

**How to apply:**
- `comeIn` replaces `p.home` for these parties: members with no order walk to the leader's town (`gatherTown`, the leader's town, not `homeOf`). Reflexes are left out: the scripted town rules send them out again and they would bounce at the gate.
- `formUp` in company.js: with a host a slotted company forms anywhere, round the highest level with a companion within 12 tiles. It covers falls, the Crypt, raids. Non-slot companies already formed in the field (`walk` in offers.js).
- `lead_to` works for any company and a solo (it said "not with the Fellowship" to all of them before). No party = a walk of your own, `not_told` names the rest.
- `C.road.walk` is the label of the order's walk. Away from the road an order's road needs that walk still in `pq`; an aim's road needs the aim not done (`CROSS.SPENT` slack, because `INTENT.NEAR` can end the walk short of `e.r`).
- Check fixture trap: on a far map `at(mem)` with `exit()` puts heroes at x -1 by a west exit; and an idle leader leaves town at once, so never wait for all members in town at one tick. See `--party` in crossingcheck.

Related: [[party-rules]], [[crossing]].
