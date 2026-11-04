---
name: paths-794
description: Solid world slice 3: moveTo walks by sim/path.js; why near lines skip A*, mobs are bounded, targets swap to reachable ground, fixture traps
metadata:
  type: project
---

moveTo asks pathLeg (src/sim/path.js). Rules added in #794 and why:

- A clear line within PATH.NEAR is walked with no plan: most steps are wander and chase, so A* stays rare (about 10 plans a second on Eldmoor).
- Common mobs search at most PATH.MOB_NODES and a chase with no way is called off (noWay), freeing the hero. No full A* for what only ever wants somewhere near.
- findMob, mob aggro and duels need clearLine: otherwise two enemies on opposite banks walk to the bridge to fight.
- A target on solid or unreachable ground is swapped for the nearest reachable ground and moveTo answers arrived, so `if(moveTo(...))` state changes still fire. Nobody freezes.
- A road laid corner to corner keeps its two shoulder tiles open (solidgrid.js): both Eldmoor bridges and the Stepping lair road are diagonal, and the no-corner-cutting rule cut them off. Not the Crypt mouth rock, which passablecheck holds solid.
- The nest is only NEST_CORE: all of the inner rock solid kept every raider out of reach.
- Journeys got 16-22% FASTER in time, not slower: roads pay and the river no longer gets waded at .55. The epic expected the reverse.

**Why:** owner: nothing walks through walls, without losing the movement feel; scale 20-30x.

**How to apply:** the plan budget resets on pathTick or a changed S.gameMin, so a check driving moveTo outside step() with a frozen clock runs out after PER_TICK plans (call pathTick). Loop changes shift the RNG: see [[check-fixtures]]; #794 broke fixtures that used one random zonePoint, a job's choice scene taking the table, and a fixed x+4 spot. An empty route must still return its goal leg: NaN coordinates teleport a walker.
