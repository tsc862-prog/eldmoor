---
name: follow-tool
description: #445 follow tool (src/sim/follow.js): pq kind 'follow', walk to last seen spot then urgent lost-them, standing follow in autopilot, why not in heroes.js
metadata:
  type: project
---

`follow {hero_id|name, hours?}` (#445, epic #402 slice 8) lives in `src/sim/follow.js`; player.js only routes a pq
command `{kind:'follow', id, name, until?, last}` to `followStep` (states town/hunt/travel/return/follow) and adds the tool,
look lines (`following`, `walks_with_you`) and one autopilot branch. pace brief `follow:{following?, followed_by?}`,
`followNote` in scripts/pacing.mjs.

Rules and why:
- **Lost them = walk to the last seen spot, then stop** (owner's choice on #445, overrides the doc's "halt at once").
  `cmd.last` {x,y,where,at} is the follower's own sighting; the urgent (w=2) event names a place only, the followed
  hero gets a soft "X has fallen behind". Hidden (Crypt) counts as out of sight, so death or descent far away never leaks.
- Not a company: no party, XP, votes or shouts. Refused: not in sight, other faction outside a shared town, a leader of
  a party of 2+ (use lead_to), a hero already following you.
- Standing order: the follow tool sets `a.playOrder={kind:'follow'}`; autopilot re-issues the follow when the hero is in
  sight and HP is above the retreat line (a reflex flee or camp took the command away). Any other act that changes
  `pq[0]` clears it (playerAct compares pq[0] before/after), and every stop in follow.js clears it.
- Pace: PACE 2.5, HURRY 2.9 past half sight, stand within NEAR 1.7. Measured 0/360 checkpoints out of sight in a
  360-game-minute walk (companycheck); the issue's bar is under 5%.
- Not in heroes.js: agent heroes run playerUpd first, so the scripted travel() never sees the kind; seeded hashes held.

**Why:** owner wants the event rare and meaningful, and no positions beyond sight and last-seen (in-game channels).
**How to apply:** later follow work (UI follow cycle, companions "who follows you") reads `followCmd`/`followersOf`;
companycheck's follow block runs on the existing world (picks the side with free heroes left) and seeds L12 heroes; init() resets since #507.
Related: [[emergent-parties]], [[autopilot-caution]], [[company-model]].
