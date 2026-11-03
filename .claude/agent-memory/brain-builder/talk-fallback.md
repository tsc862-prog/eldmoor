---
name: talk-fallback
description: #540 scripted talk answers read the question (townAnswer/publicAnswer in talk.js), warning only when it fits, scripted tag, DM grace
metadata:
  type: project
---

#540: `townAnswer(p,a,text)` in `src/sim/talk.js` (exported `publicAnswer`) keyword-matches the member's line against public things only: placed people (S.npcs, wanderers), ZONES, CITY, LANDMARKS, S.places markers, the Crypt, the open board of the person's town (`JOBQ`/`CRYPTQ`); a capitalised run nobody knows gets "Never heard of X. Try the inn, they hear everything." Never DM notes, wants, fmem or campaign. No RNG.

- `scripted()` uses it first; the greeting pool and the role follow-up only when nothing matched. `lore(p,a,fit)` drops the green-blade warning unless `c.fresh` (first meeting, `a.metNpc[p.id]`) or `c.fit` (question about the Crypt).
- Non-Fellowship path in `player.js talk` uses `publicAnswer` too; the fixed warning only on a first meeting.
- `speakAs` already carries `by:'scripted'`; `chatLine` (panels.js) adds a dim "scripted" span for trigger npc. Scene fills are tagged too.
- Grace: `dmBudget` returns `CONV.GRACE_MS` (12 s) when the seat is open, not polling, but `setDmAlive(fn)` (wired in ui/runalert.js from dmLink) is true or a DM call was within `BUSY_MS` (90 s).
- Pitfall: tablecheck --talk cases live before "Table off"; JSON.stringify of a hero circles (party.leader).
