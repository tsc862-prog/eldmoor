---
name: call-to
description: "#826 part 2: call_to lever and answer_call solo tool (callto.js): limits, C.calls shape, hook into resolveProp, musterWord, test pitfalls"
metadata:
  type: project
---

The world never asks a company to the Crypt or a raid; only the DM's `call_to` does (`src/sim/callto.js`, installed from index like seed_rumour). Company: `askCompany` with `src:'dm'`, `caller`, `details`=the line. Solo: no proposal, question on `C.calls.last` with `until`, answered by hero tool `answer_call` or by its own go_crypt/join_raid; silence settles lazily to `unanswered` (`settle`, on any read).

**Why:** owner decision on #826: the world engine never prompts, the DM may ask with a reason; the vote stays the agents'.

**How to apply:** per-company limits live in `callRefusal` (lever `check`), the lever's own `perDay` is `CALL.ALL_DAY` so reserve and fairness have a day to share. `pullTouches` knows `p.company`. `pileOn` has its own call_to branch (whole company, not a spot). pull_lever reroutes to `callTool` so names resolve; a `when` is checked by `whenCheck('call_to')`.

Pitfalls: `put()` with hp before setting lvl makes a test hero "badly hurt", so set lvl first. In a world with no runner links reflexes vote at once and the company really goes down, so channelcheck's case sits last, before the verdict. Bash heredocs eat backslashes (`\b`, `\r`, `\'`): write fix scripts with Write, see [[rumour-bestow]].

Related: [[dm-flat-tools]], [[dm-when-watch]], [[rumour-bestow]].
