---
name: log-outcome-tags
description: #785 history.js OUTCOME regex leaves src off outcome log lines (level, slew, loot, fell, downed, bonds, oaths); decisions keep srcOf
metadata:
  type: project
---

record() in history.js drops `src` when the line text matches `OUTCOME` (start-of-line patterns), instead of editing 127 call sites.

**Why:** the Log tab read "agent order" on Reached level and other outcomes nobody ordered.
**How to apply:** a new outcome line kind (something that happens to the hero) needs its opening words added to OUTCOME; decisions stay tagged. uismoke has the cases. Hashes unchanged (no RNG, text only).
