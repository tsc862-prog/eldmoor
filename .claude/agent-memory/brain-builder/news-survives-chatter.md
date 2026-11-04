---
name: news-survives-chatter
description: Why localcheck B failed on Linux - minor lines evicted unread news from a.playEv; makeRoom/mostNews rules and the fixture lessons
metadata:
  type: project
---

Unread news used to be lost two ways: `ev` shifted the oldest line of the 40-line list whatever it was, and `takeEvents` showed the newest `PK.EV_OUT` 15 yet marked everything seen. Now `makeRoom` (notify.js) gives up the oldest read line, else the oldest of the lowest wake level, never the newest; `mostNews` shows every line with a wake level and fills up with the newest minor ones.

**Why:** localcheck B's pin clears `a.pq` every 50 ms, so autopilot writes "Autopilot: ..." once per tick from 2.5 s after the last act. CI trace: notice left the list unread 3.67-3.87 s after it was dropped, just inside the 4 s gap, so no soft wake. Linux ticks 50 ms (2.35 game min a line), Windows about 62 ms (3 game min), which is why it never failed on the owner's PC; `--min-gap 6` fails every time on Windows. Live too: unpinned autopilot heroes had more than 24 lines unread in 2 to 7 of 9 windows of 960 game min (a 20 s gap at 8x).

**How to apply:** a heartbeat wake with news dropped = look at the list, not the clock. `now` wakes in a parked town are `townGuard` (12 game hours idle, urgent 2) and downed hearing (section B now has it off, like A). A section measuring a gap must time from when the wake could first come, not from the last turn. Git Bash mangles `rev:path` args on Windows (`git show a/b:c`): use a file or MSYS_NO_PATHCONV=1.
