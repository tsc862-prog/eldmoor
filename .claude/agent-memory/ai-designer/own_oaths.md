---
name: own-oaths
description: #800: agent heroes' rolled goal is an offered thread until sworn aloud; swornOf is the one reader, dice stay in goals.js, one offer, keep_oath for words
metadata:
  type: project
---

For agent heroes the rolled `a.goal` is an offered thread (`g.offered`, set in `markPlayer` on the false-to-true edge) until the hero swears. No flag = sworn: that is what keeps scripted heroes and older saves unchanged with no migration. Read with `swornOf`/`threadOf` from the leaf `sim/oath.js`; write with `sim/sworn.js`.
**Why:** owner, 2026-11-04: "Why does the narrator put the agent in situations he didn't create?" The past is given, the oath is chosen.
**How to apply:**
- New code that speaks of an oath reads `swornOf(a)`, never `a.goal`. New mechanics may read `a.goal`, because hash worlds have agent heroes (Fellowship, autopilot row).
- Hashes hold because a thread keeps every die: `complete`/`voided`/`next` still roll, only the words go. `next()` on an agent hero hides the roll (`g.aside`), so "A new oath" is never said for them. Hash probes read positions, levels, gold, not the chronicle.
- `pilgrimStep` stops steering for a thread only under `hasLinks()`: a hostless world must keep its moves.
- One offer: first table, then the first dusk reflection (`reflectDone` sets `g.quiet`), then silence. `OATH.ASK_MIN` covers runners with reflections off.
- Untrackable words never auto-keep; `keep_oath` is the hero's own word, safe because no reward hangs on it. A kept oath leaves `a.oathKept` because `a.goal` moves on at once (the old `oath_kept` trigger could not see `done`).
- DM sees threads (they are game text, not hero words) but not a set-aside one, and the set-aside note goes to the notebook, not `memory.js`, whose recent lines the DM reads.
- Timeline swearing uses kind `swore`, not `oath`: legends.js counts every `oath` entry as a high oath kept.

Pitfall: fixtures that call `swear_oath` on a fresh agent hero now get an oath, not a vow, unless they pass `days` or the hero holds a sworn goal. Goals also change under a test (next() leaves a hidden goal), so assert on `questLog` after setting the goal. Table beats keep the applied text in `b.res`, not `b.text`.
Not changed: origin texts that say "swore on a kin's bones", the company's founding and arrival "swears the oath" (the company's, not personal), persona `wants` seeded from the thread (private; the reflex intro leaves it out).
Related: [[sworn-vows]], [[arrival-session-zero]], [[fireside]], [[quest-log]].
