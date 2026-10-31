---
name: elites-ecology
description: Tuning decisions behind the zone ecology (spawn pressure, road drift) and the four named rare elites, with the sim numbers that justified them (2026-10-31)
metadata:
  type: project
---

Ecology and elites were built 2026-10-31 for issue #9 (branch creatures/ecology). Knobs live in `ECO` and `ELITES` in `src/data/mobs.js`; logic in `ecologyTick`/`updMob` in `src/sim/mobs.js`.

**Elite aggro rule (lvl >= elite.lvl-2, hp >= 90%, 2.2 tiles, 50%/scan):** heroes never choose to fight an elite (`findMob` skips mobs above lvl+1 and `MOBS[type].z !== a.zone`), so engagement is the elite's choice. At hp x2.2 / hit x1.5 a solo hero at or below the elite's level cannot kill it in one fight; it flees at 22% and the flee lag (p=.02/frame) kills roughly 1 in 10 of heroes whose 22% HP is below one elite hit. In practice that was 0-3 deaths per 120-min run, all L5-6 vs Hollowfang (L7). A -1 rule would make Ulfryn (L22) unkillable since heroes cap at 20, so -2 stays and Hollowfang is the accepted cost.

**Elites regen 1%/s instead of 10%/s.** Why: with normal regen an elite is full 10 s after a hero flees and would never die solo; slow mending lets successive hit-and-run heroes wear it down. L20 heroes do kill Ulfryn this way (one hero took 6 in a run at eliteRoll 25, which is why the roll was lowered to 1-in-35).

**Spawn pressure numbers:** zones are empty often enough that 150-270 extra spawns and nearly as many culls happen per 120-min run (mainly Cinderpass/Hoarfell before anyone reaches them); end populations 22-35 per zone vs targets 30/28/21/25. Culling happens at respawn time so a swollen zone thins only as heroes kill.

**Thornvale spillover:** roads at x<18 are excluded from drift targets (`roadMinX`) from the start, because L1-2 deaths to Webspinners/Boars are already the biggest mob-death line (11-58 per run, huge variance) and recruits walk that stretch. No measurable change in L1-2 deaths after the feature.

**Known gaps to hand off:** `agentDie` still logs "fell to a Timber Wolf" when Hollowfang kills (heroes.js, ai-designer); hero card does not show `a.eliteKills` yet (ui). Helpers could make elites group content (ai-designer).

**How to apply:** when adding a zone or elite, keep the elite at zone max+2 with these multipliers, verify with 3+ x 120-min runs counting `S.eco.stats.eliteDeaths`, and check who the realistic killers are (travellers passing through lower zones are the main elite slayers).
