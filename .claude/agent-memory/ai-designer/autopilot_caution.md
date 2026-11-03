---
name: autopilot-caution
description: #487 wary autopilot - runner-less agent heroes keep scripted-style caution (wary hunts on one ground, prey <= lvl+2, flee .22 / .5 from a foe above, home when hurt, 90% before heading out); survival numbers and why WARY_UP is 2
metadata:
  type: project
---

Autopilot (src/sim/player.js) hunts are `wary` (cmd.wary, cmd.ground): `waryPrey` takes only natives of the ground, no
elite/named, none feared (lore), none above lvl+`PK.WARY_UP` (2); walks stay on the ground and range across it after
`PK.ROAM` empty legs. fight(): while autopilot (a.playIdle or cmd.wary) breaks off at `WARY_FLEE` .22 x flee trait, at
`WARY_OUT` .5 from a foe above lvl+WARY_UP or a named one (the ones that jumped it). Field: below .45 x retreat -> home;
below .6 rests only with no creature within `REST_CLEAR` 6, else home; storm -> home. Town: rest to `READY` .9 first.
Agent orders (hunt without auto) keep pickPrey and PK.FLEE .15: the agent's choice.

**Why:** Thornvale's band is [1,5] but spiders 3-6 and boars 2-5 aggro; old autopilot hunted anything unfeared, drifted
into Mirefen chasing prey, and rested in the open. 8 seeds, 5 L1 heroes, 2 game days: 5/40 alive before, 39/40 after
(scripted 38/40). WARY_UP 1 (the scripted findMob rule) gave 40/40 but level 2.1 vs scripted 3.6: solo agent heroes
get no party XP share and ~28 L1 heroes compete for a few wolves, so +2 it is (level 3.2).

**How to apply:** the seeded hash (professioncheck --hash) is unchanged - only a.player heroes. townpilotcheck "silent"
now asks level 2 (not 3) in 24h. Fixtures: an old scripted hero may still sit in another party's mem (partyTick sends it
home) and its goal/traits matter; clear them. Harness idea: scratchpad greensurvive.mjs pattern (mark 5 L1 heroes,
`init({fellowship:false})`, 2880 game min). Related: [[town_autopilot]], [[learn_the_world]], [[check_fixtures]].
