---
name: slot-scene
description: "#687: takeClaudeSlot due/onDue + scene:true slot priority, queued why (slot/turn/queue) and miss cause, wait holds at an answered scene (WAIT_SCENE_MS)"
metadata:
  type: project
---
#687 (PR #695, stacked on #694/#689): `takeClaudeSlot(base, log, {key, due, onDue})` in scripts/pacing.mjs polls `due()` every
DUE_POLL_MS (1 s) while waiting. When the scene is due it calls onDue once (POST /play/pace {queued:true, why:'slot'}), aborts the
pending request and asks again with `{scene:true}`. The returned release fn has `.scene`, and agent-player re-reads b0 so the
scene-first answer runs. Supervisor (runners.mjs /play/runner/slot): scene waiters go before non-scene ones. `res.on('close')`
drops a waiter whose client aborted, and a lease granted to a closed response is put back.
Game: markQueued(a,on,why) keeps `sc.qw[id]`. `missCause(sc,id)` returns 'waiting for a slot' | 'mid-turn' | 'model queue' |
'queued' | 'no answer'. The scene-missed anomaly evidence has `cause`, and sceneAnswers adds a "missed by cause" column.
hostCall `wait`: at a scene the member already answered it holds until the scene settles (checked before waitOver, because the
vote-result event is urgent), at most WAIT_SCENE_MS 240 s. It returns why 'the table settled' + scene_outcome.

**Why:** live (owner's world): Dunys waited for a slot when his Crypt vote opened, his reflex voted, and the others looped `wait` 0 min.

**How to apply:** a test of the supervisor with the real world: attachPlay(localBackend()) resets setRunnerLinks, so call
setRunnerLinks after it. Fellowship reportQueued(m, why) infers slot/turn/queue from m.slotWait/m.inTurn.
