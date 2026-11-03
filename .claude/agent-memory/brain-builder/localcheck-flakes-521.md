---
name: localcheck-flakes-521
description: #521 localcheck flakes - exit vs close race, session file written after the turn line, unpinned lazy-model hero
metadata:
  type: project
---

Causes found by reading (the failures do not reproduce locally; 7/7 and 3-parallel passes before the fix): child `exit` fires before stdout drains, so the last turn line (reflection) could be missing from `R.out`/`out()` -> helpers now wait on `close`. The runner prints `[turn N]` before it saves the session file -> section I waits for both. Section C (mock-lazy, AAAEEAAE): an unpinned hero drifting off town makes rest/wait refuse and a repeated narration reads as an empty turn -> hero pinned (park + full hp every 50 ms) while it runs. dmcheck focus share is a seeded child sim; #530 (985ee63) already fixed it.

**How to apply:** in check scripts wait on `close`, wait for every artefact asserted (line AND file), and pin fixture heroes; never widen a window.
