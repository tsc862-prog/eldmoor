---
name: party-rules
description: Behaviour rules added for hero parties (issue #4) and the reasons behind each; read before touching party.js, follow/regroup states or duel flee logic
metadata:
  type: project
---
Parties (src/sim/party.js + follow/regroup states in heroes.js) were added 2026-10-31 for issue #4.
Rules that are NOT obvious from the code and why they exist:

- Followers live in their own `follow` state, not `hunt`. **Why:** pvp.js only duels heroes in hunt/travel/return and mobs only ambush hunt/travel. With followers in `hunt`, a 3v3 meeting rolled 9 duel pairs and doubled PvP deaths; with the leader as the party's only contact point the duel rate per Mirefen hero-minute returned to baseline.
- A dueling member stays in the party (design draft said remove them). **Why:** the leader is the only duel-able member, so removing the dueler orphaned the leader on first contact and produced solo heroes mid-Mirefen (38 of 114 PvP dead were orphaned within 30s).
- `regroup` (2.5s pull-back, 3s for a duel fleer) after any skirmish. **Why:** chain duels (new duel within 4s/8 tiles of the last) were 51% of duel starts when assisters dropped straight back into `hunt` beside enemy survivors.
- Party zone = zoneFor(weakest member), not the leader. **Why:** level 6 is the deadliest level (half of PvP deaths); sending level 4-5 followers into Mirefen behind a level 6 leader increased Mirefen hero-time 2x. This was the change that finally brought deaths back to baseline.
- Leader steers away from enemy heroes within 6 tiles in hunt and return (`steerClear`). Small effect alone, kept as caution.
- Duel flee: 50% HP when outnumbered (assisters on you, none on foe), else 20%. Deaths/duel fell 0.62 -> 0.37-0.45. Applies to solo heroes too; flagged in PR #4's description as the one non-party behaviour change.
- Shared XP is 60% to mates within 8 tiles (design). It roughly doubles leveling pace; expect more heroes in Mirefen/Cinderpass than before.

Open follow-up (not done): 33-44 of ~75 PvP deaths per 2h have a killer 3+ levels higher. An "avoid/flee outleveled enemies" rule in the duel state would likely cut PvP deaths further (roadmap item 5).
