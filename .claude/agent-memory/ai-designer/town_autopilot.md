---
name: town-autopilot
description: #466/#465 rules - autopilot acts in town (inn, sell, potions, hunt a fitting ground), field autopilot hunts/moves on/goes home, danger-edge stop for walks 5+ levels up, apart note
metadata:
  type: project
---

Autopilot (`autopilot`/`townPilot` in src/sim/player.js, knobs `TP`) now carries on in town: inn rest when hurt -> sell loot
(4+ entries) -> buy up to 2 of the best shop potion -> walk to `a.playGround` (set when a hunt picks prey) or the known region
whose band holds the level -> hunt 5. Field with no hunt order: hunt if the region fits (lowest level <= lvl+1), move on when
outgrown, go home when beyond. A follower waits for a leader in town `TP.WAIT` (240) more game min, then hunts nearby. An
open Fellowship vote holds it. It never takes jobs/bounties/Crypt/raid.

**Why:** playtest #302: 32% of member-hours idle in town; local models' turns last game hours, followers sat at the gate
behind a leader refused "needs level N" for 30-84 game hours. Owner: autopilot may act, decisions stay the agent's.

Danger edge (#465, `guardWalk`): move_to / hunt {where} whose sampled road enters a region with band[0] >= lvl+5 stops at
the last safe point once (`a.playDare {z,t}`), warning in words (biome FEEL, placeWarn, npcWarning); same call within
12 game h or `force:"yes"` goes on. **Why:** Keris L1 explored into Hoarfell alone and died; owner wants maximum agency, so
warn then allow, never a hard block. `apartNote` says when a walk leaves a non-following leader out of shout range.

**How to apply:** only `a.player` heroes reach this code, so the seeded hash (professioncheck --hash) must stay equal to
main. Fixtures that walk a low hero across a high region now get `stops_short` first (lorecheck had one; call again). Fixtures that need a member idle/stuck in town must keep it there through its agent (behaviorcheck: runner orders rest hourly), since autopilot now walks out.
Check: `npm run townpilotcheck`. Related: [[turn_hold]], [[learn_the_world]], [[emergent_parties]].
