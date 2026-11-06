---
name: turn-waste
description: runner turn waste fixes - refused scene_act cause, wait cap, listen double name (aside.js regex)
metadata:
  type: project
---

Cause of refused scene_act (26 of 119 in a Vale session): standing orders said "TABLE MODE ... act at once" with no condition and wake lines begin "TABLE (crawl): ..." even after the scene ended; fix = conditional wording + sceneNote(b) in claudeBrief (b.scene = member own due scene). Turns at the 10-call cap had 3-5 waits: CLAUDE_TURN_ORDER now asks for one wait. Listen "Name Name says nothing": emoteAct name-strip regex had unescaped backslashes (never matched); fixed in aside.js. Evidence logs live in logs/behavior/<world>/turns.jsonl (world name vale, not the wmw id).
