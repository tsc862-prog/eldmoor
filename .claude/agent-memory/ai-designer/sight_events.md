---
name: sight-events
description: #570 sighthero.js - sight events for companions/sought hero, stop on sight for seekers, In sight header line, Looking for purpose
metadata:
  type: project
---

sim/sighthero.js: noticeHeroes(a) runs in playerUpd after watch/intentWatch (agent heroes only). Event "You see X to the east, about 8 tiles off" only on coming INTO sight (first look is a silent baseline, a.sightNow), once per hero per 60 game min (a.sightAt), never inside a town. Companion / hero named in the live aim = urgent (2); merely met (talkHeard both ways) = soft.
Seeker = aim has a seek verb and names the hero; if autopilot (a.playIdle) is walking a move command it clears a.pq, sets a.face, and writes intent.sighted; intentPilot then returns a 30-min rest ("holding where you are") until the agent acts, so the walk never restarts.
Header: brief.insight -> "In sight: Name (E, 8 tiles)" (companions/sought beyond 7 tiles), pacing.mjs sightNote after earshotNote. Purpose line: "Looking for <name>" when the aim seeks a hero.
**Why:** a walker passed a silent companion because only turns looked around. **How to apply:** sight uses FOLLOW-like 12 tiles x sightMul (fog/storm); night does not shorten it (no night factor exists in weather.js). Tests in scripts/companycheck.mjs "sight (#570)". Hash proof: professioncheck --hash equal to main.
