---
name: invitations
description: "#872/#864 invite.js: rare header line and look fields naming tools; why marks ride playFresh and why events were rejected"
metadata:
  type: project
---

Tools nothing invites get words in `look` and at most one rare header line (`brief.invite`), never an action. Scope was trades, gathering and attempt; #829 did wishes.

**Why:** 0 learn_profession/craft in 2,330 turns, 1 attempt in 3,900. Owner's cost rule (#799): every header line pays on every turn.

**How to apply:**
- Not events: at 1x a turn is about 6 game hours apart, so a tick-posted "herb patch 4 tiles north" is stale when read. The line is computed at read time.
- `inviteBrief` must stay a pure read; marks go in `inviteSeen` on the `a.playFresh` brief only, or the relay's after-turn brief spends the line unseen.
- First cut (daily no-trade spots, 3 spots, trainer tail) put a line on 33% of turns; SPOT_GAP 3 days and 2 header spots brought it to 12-18%, +14-20 chars mean. Spots are everywhere, so anything keyed on them needs the longer gap.
- There is no trainer NPC: "Trainers here teach ..." names none. `wakes.js` must not import invite.js (heroes -> wakes -> ruling cycle).
- Measure with a seeded Fellowship, closing reflections, since a due reflection suppresses the line.
- Left out on purpose: talk mentions, a level-3 reflection moment (a turn costs more than a line), report counters.
