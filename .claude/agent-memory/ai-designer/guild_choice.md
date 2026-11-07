---
name: guild-choice
description: #954 guilds.js open() keeps company members and agent heroes out of scripted guilds under hasLinks; guild_join/guild_found tools
metadata:
  type: project
---

With `hasLinks()` the guild script never founds or enrols `a.company!=null || a.player` heroes (`open()` in guilds.js); hostless worlds are unchanged so hashes hold. Agents use `guild_join {guild?}` (no name lists open guilds) and `guild_found` in town, level 3+; founding enrols only script-eligible comrades (never other agents). Existing membership is kept (old saves). `npm run guildchoicecheck`.

**Why:** Hard rule, every decision of a company member is its agent's (#954).
**How to apply:** any new script path that enrols or binds a company member needs the same hasLinks gate.
