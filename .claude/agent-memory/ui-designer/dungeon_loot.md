---
name: dungeon-loot
description: #976 what a clear paid - record on S.dunRec rows and site.paid, st.looted, History Took lines, the probe's stageLooted and shoot --looted
metadata:
  type: project
---

What a clear paid (#976): `paidNew/paidGood/cryptPaid` in `sim/crypts.js`, written by `payClear` (row `.paid`) and `clearSite` (`s.paid`). Only the last clear is kept; `paid.run===row.runs` says the last run on record was that clear.

**Why:** the view's runs are session memory, so looted marks and "Took" must survive a reload through the sim record. A withdrawal takes nothing, so only a full clear marks chambers looted, not each room beaten.

**How to apply:**
- The strike DC is `CRAWL.DC` (9) + level/2 in the code; the issue and CLAUDE.md's old text say 10. Read the constant.
- A Crypt chamber's foe level follows the party, so nobody fighting and no run seen reads "DC 9 + level/2".
- uismoke stages runs by hand without `cryptRun`: a real clear from the warm-up then wins in `endedClear`, so staged blocks must blank `S.dunRec`.
- Staging a clear needs a frame between `cr.end='clear'` and dropping the group, or the view closes the run as "ended" (real play has the tally bump). `shoot.mjs --looted` and the probe's `stageLooted` do this. See [[dungeon-view]].
- Heroes in uismoke carry a stub goal late in the file: `getEpic` crashes unless `a.goal=null`.
