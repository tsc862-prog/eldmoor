---
name: dm-adventures
description: DM phase 1 (issue #63, epic #62) design rules for sim/dm.js adventures - why the leader drives in ordinary states, the "told" chronicle budget, hook board rules, XP/honor sizing and how to measure
metadata:
  type: project
---
Scripted DM and adventures (src/sim/dm.js + src/data/adventures.js, branch ai/adventures, 2026-11-01).
Rules that are not obvious from the code and why:

- **No new hero state.** The leader drives the adventure from inside the ordinary `travel`
  and `hunt` cases (dmTravel/dmHunt inserted at the top; dmDepart at the town gate). Fights
  are the normal `fight` state, followers stay in `follow`. **Why:** PvP, mob ambush, road
  encounters and party joins all key off those states; an `adv` state would have made
  adventurers immune and moved deaths a lot. Deaths stayed within noise (47 vs 48/2h).
- **Going home is not failure.** Any path home (flee, storm, party heading back, crypt/raid
  pull) is caught in dmTick as `adv.away` (foes despawned, scene restarts next trip). Only the
  leader's death, three game days, or nobody left on it end an adventure badly.
- **Camp between scenes** below 60% HP (CAMP), go home below 25% or when a mate <30% mid-fight.
  Without camps adventures were a chain of home trips.
- **Hook board:** 3 posted per town plus personal (oath/follow-up). Zone-bound hooks (graves,
  remnants, elite rumours) live half as long, and if none of the posted ones is open-ended the
  oldest is replaced. **Why:** with 2 slots, zone-bound hooks clogged the board and 'nofit'
  was the most common departure result.
- **Chronicle budget ("told"):** only TOLD=2 adventures at a time (plus the watcher's pinned
  hero's) narrate every beat; the rest go to record() except elite-hunt ends and deaths.
  **Why:** ~270 adventures/h start; full narration was ~1000 DM lines/h (chronicle 2.5x).
  Now ~400/h (+26% chronicle). Never put routine lines on `big`.
- **XP:** PAY_XP .3 x template pay.xp and CHECK_XP .35 keep mean level ~+5% over main.
  At PAY_XP 1 / CHECK 1.5 levels ran 35% fast. Honor goes to the hero only, never
  S.facStats honor (that scoreboard is PvP; adventures tripled it).
- **Timeline:** only first-of-kind per faction and hunted real elites. Named-foe kills on the
  timeline filled the 200 cap.
- Named foes are spawnMob + overridden stats with `m.named`, never `m.elite` (elite would set
  the zone's elite cooldown, guarantee an epic and trigger narrator elite lines).
- Hook objects become the adventure in place (Object.assign onto the hook): a copy once
  lost the `told` flag silently.

Measure with a scratch run.mjs that samples `a.adv` share among lvl5+ heroes, S.dmStats,
chronicle lines/h and timeline kinds; pin the top hero (`S.pinned`) to get full transcripts.
See [[narrator-rules]] for the noise warning (deaths 37-57 per 2h run on both branches).

## DM log (issue #76, branch ai/dm-log)
- `S.dmLog` (cap 200, newest first) written via `dmlog(kind, adv, summary, detail)` in `src/sim/dmlog.js`; panel in `src/ui/dmpanel.js`. Logging uses no RNG, so it cannot move sim results.
- Volume rule: hook entries are one per town per refill; the scene frame text is merged into the scene's roll entry (separate `frame` entry only for rest/no-check scenes); complication entries only when one fires. Measured ~110 entries per game day (target <150). Do not add per-tick or per-nofit entries.
- A model-backed DM calls `dmNote(prompt, reply)` before its slot answer returns; the next entry carries them.
