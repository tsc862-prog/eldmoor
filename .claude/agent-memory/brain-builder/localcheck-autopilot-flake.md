---
name: localcheck-autopilot-flake
description: Why localcheck's autopilot and "other news" checks flaked and how the fixture pins them
metadata:
  type: project
---

localcheck autopilot section: the held fixture hero still regenerated and drifted (into a town on CI) during the ~5 game min before idle triggered, so hp passed 60% and autopilot hunted instead of resting. Fix: `pin` {x,y,hp} reapplied in `calm()` until `a.playIdle`, released before the "mended" step.

"other news starts a turn" (section B): the wake line may not name the traveller (other world news), and the upper bound 9 s was tight under load. Now any `soft` wake after the notice counts, 6 tries, bound 14 s.

**How to apply:** fixtures that wait on autopilot must pin position and HP until the thing under test fires; never assert wake text, assert wake kind.
