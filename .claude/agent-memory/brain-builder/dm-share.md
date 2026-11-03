---
name: dm-share
description: #541 DM agent share metric - dmShare digest field, dm-scripted anomaly, report section, what old logs can't give
metadata:
  type: project
---

Digest field `dmShare {kinds:{talk,table,slot,levers,board,branch,staged,voice}:{agent,late,scripted}, seat:{closed,norunner,live,waiting,unknown} (game minutes), agentShare}` from `makeWatch({dmLink})` in `src/sim/behavior.js`. Read-only, derived from existing counters (S.talks.stats dm/late/scripted, S.staged.stats answered/late/filled, S.dmStats.fallback) and DM log entries; no new S state, hashes unchanged.
- Answerable = talk + table + slot. Others are context (the DM agent has no branch tool, so branch is all scripted).
- DM link is not in the sim: the page passes `dmLink` from player-bridge, play-headless from `playRef.claimed('dm')`. No fn = seat state `unknown`, no anomaly.
- Anomaly `dm-scripted`: BW.DM_SHARE .5 / DM_WIN 120 min / DM_MIN_CALLS 4, only after the seat was held (live or waiting) for the whole window; no runner = no anomaly.
- Report "## DM agent share": per kind, per game day, per model (digest goes to the model of the DM's latest turn before it). Old digests print "predate #541", never zeros.
- Owner's logs (968 digests, day 2): no counters. Computable only: DM turns 142 (qwen 110, Sonnet 17, Haiku 15), levers scripted 129/4 vs dm-agent 102/138 pulled/refused, 66% of DM actions touched the Fellowship.
- Pitfall: python heredoc edits of JS eat `\n` and `\|`; check with node --check.
