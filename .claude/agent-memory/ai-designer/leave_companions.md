---
name: leave-companions
description: #443 leave_party for_good (offers.js leaveForGood), companions read tool, a.seen last-seen record in reach.js, AWAY leave kind
metadata:
  type: project
---

`leave_party {for_good}` -> `leaveForGood` in offers.js (not company.js: it needs offers' busy/table refusals and council's COUNCIL.BOND_COST without an import cycle). Solo is refused ("You ride alone already"), the five-slot Fellowship is refused (split instead), bonds drop BOND_COST both ways, old log gets a `leave` line (AWAY.KINDS gained `leave`), the leaver becomes a fresh solo via soloFor.

`companions` tool (read-only) = companionsView in offers.js: riders with "beside you" or "last seen near <place>, N game hours ago" from `a.seen[mateId]` (written by reach.js noteSeen each tick for companions in shout range; place = town or region name, never coordinates). Folds in earshot, plans, couriers, offers.

**Why:** in-game channels rule: only what the hero perceived. **How to apply:** never read a mate's live position in a tool; record at sighting time. Default hash unchanged (a.seen is not in the hash recipe; no RNG). Compare hashes with a `git archive` extracted to the scratchpad (no node_modules needed).
