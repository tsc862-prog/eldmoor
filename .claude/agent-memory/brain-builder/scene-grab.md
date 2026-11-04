---
name: scene-grab
description: #687 follow-up PR 737 - sceneGrab aborts a mid-turn Claude query when its own scene is due 15 s; resume; banner queued countdown
metadata:
  type: project
---

`sceneGrab({due, abort, onGrab, ms=SCENE_GRAB_MS 15000, every=1000})` in scripts/pacing.mjs; fellowship.mjs `claudeTurn` uses `m.due` (set by the 1 s health watch), agent-player.mjs polls /play/health. Fired: ac.abort(), catch ignores the abort (not a failure), the existing "turn ended without scene_act" forced claudeScene answers, flag `scene-grab`, then a resume turn (fellowship: recursive claudeTurn with `again`, GRAB_RESUME prefix; agent-player: `resume` flag skips between()). The aborted turn has no result message, so its cost is not counted. Not verified live: the SDK resuming a session cut mid tool call (check logs if a resumed turn errors).
Banner: memberRows and tableView lines use `liveLimit(sc,a,TABLE.liveMs)`, "queued · reflex in N s".
Test pitfall: scenewaitcheck G mocks the query as a promise that ends on abort; the real SDK path is not exercised.
