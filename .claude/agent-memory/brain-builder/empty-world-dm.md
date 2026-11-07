---
name: empty-world-dm
description: others none prep - dm_status.others wording, first-turn clause, SUMMON limits judged fine, 5-day Vale mock run findings
metadata:
  type: project
---

dm_status.others (only when noOthers) now says: roads empty unless summon_hero, caps, why (rival, road meeting, healer/trader), company alone is fair. dmTurnPrompt(0, st) adds one clause only when st.others. Standing orders untouched (line 133 already names summon_hero). Checks in summon-test.mjs.

Mock run (Vale, others none, 2 summons a day, 5 game days): no errors. Refusals when the company stands in a town: "no company stands in X" / other-faction town (near:'fellowship' resolves to the town); the message names the way on. Summoned L2 hero died to an eel (default level = company average). Guilds need several same-faction heroes; 3-4 summoned form none. Auction goods floored. SUMMON limits left as is.

**Why:** owner leans to others none; no live DM ever called summon_hero.
**How to apply:** if a live run still never summons, look at the turn log before adding more words.
