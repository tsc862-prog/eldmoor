---
name: dynamic-guilds
description: Guilds are founded/joined/split/disbanded by heroes (sim/guilds.js); a.guild may be null; ids numeric; gotchas for null guilds
metadata:
  type: project
---

Guilds are no longer fixed (issue #56, PR characters/dynamic-guilds). `S.GUILDS` starts empty, guild `{id,name,tag,fac,founded,leaderId,clears,wipes,bosses,retired}`; ids from `S.guildSeq`, never reused; save v2 migrates tag-keyed refs. Names from `genGuild` + `GUILD_VOICE` in data/factions.js.

**Why:** the fixed four hard-coded guild counts against the built-to-scale rule.
**How to apply:** every read of `a.guild` must be null-safe, and `x.guild===a.guild` comparisons need `a.guild&&` (null equals null otherwise). Split trigger is a proxy (rival/avengeHero strangers) because bonds and nemeses never cross factions. Post-change 120-min runs: ~42 deaths, 4-8 living guilds, several of size 1-3.
