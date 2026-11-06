---
name: nightly-mock-scenes
description: #822 nightly run - why it failed: mock-tools answered no scene, then agent hunt crossed the river to deadly prey, wiped the Fellowship, runner left and no supervisor brought it back
metadata:
  type: project
---

Three layers, found one after the other; each hid the next.

1. `mock-tools:1b` has no branch for a forced scene answer, so every scene went to reflex. `mock-table:1b` fixed that (it answers with a legal option). Keep mock-tools untouched: localcheck counts its calls.
2. Real game bug: `pickPrey` (agent `hunt` with no prey) had no clear line and no region limit, though the tool says "where you stand" and #794 says no prey without a clear line. A level 2-3 hero on the Thornvale bank picked a Fen Lurker or Hoarfell creature it saw across the river and walked round by the bridge to it. It wiped the 5 mock members by day 2, and the owner's own logs have L1 heroes slain by Rimehound, Mudback Boar, Fen Lurker. `feared` only counts after a first sight, so a first pick is never stopped by the threat read.
3. Harness gap: a Fellowship runner exits when its last member dies; in the game `adopt` in runners.mjs starts it again for the recruits, but nightly-run.mjs had no supervisor, so the remaining 56 minutes measured seats nobody played: on 2026-11-06, all 309 reflex table turns, all reflex-scenes and stuck-state came after the runner left at minute 4 (link "none"); before it, 0 reflex, 0 missed. nightly-run now restarts it (only when every member ended dead).

**How to apply:** read an anomaly count with the digest's `link` beside it before blaming the table: `link: none` means no runner. A short run hides this; the wipe decides everything after it. A priming `pickPrey` call in a test records a sight and changes the next pick (feared), so repro through `hunt` and `step`.

4. Mock minds again, once the wipe was gone: `mock-table` hunted on at half HP and struck at every rescue instead of healing, so a bad seed lost 4+ members to home-region creatures; its short line list repeated in long fights and the near-copy rule refused it (refused-calls). It now rests below 60% HP, heals and stabilizes first, and its lines carry unique tokens.

**Pitfalls:** worlds are unseeded, so one pass proves little: n3 had 1 death, n10 had 4 by day 3 on the same game code; run two. A runner usually picks up recruits itself, and exits only when the last member's death comes before any recruit, so the nightly restart is rare. A fallen member can end as `done (left agent play)`, and can lose fellow/agent flags in the digest's deaths. Backslashes in a heredoc get eaten: use Edit for regex text. Killing nightly-run by pid also ends its children.
