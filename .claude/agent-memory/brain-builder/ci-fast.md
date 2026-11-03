---
name: ci-fast
description: #543 CI job split, CI_FAST knob (scripts/ci-clock.mjs), what is timer-bound vs CPU-bound, parallel children in dmcheck/ratecheck
metadata:
  type: project
---

CI jobs (ci.yml): core, world, ui, agents, local (localcheck), launcher (upcheck), rate, dm, minds-a, minds-b; `ok.needs` lists all. New check = a step in a job; new job = also in ok.needs and its `test` line.
`CI_FAST` is read only in `scripts/ci-clock.mjs` (`ms(n,min)` divides by 10); ci.yml sets it to 1 except on the nightly schedule and workflow_dispatch `real_timing`. Only check scripts import it, never play code.
**Why:** most "slow" checks were CPU-bound (sim children), not timer-bound. Real timer wins: upcheck UP_GRACE_MS 15 s -> 3 s (67 s -> 26 s). Scaling upcheck's settle sleeps broke it (they wait for real child state), keep them real.
dmcheck: `primeKids` starts the seeded children (--focus x4, --starve...) at once; the local `spawnSync` shadow hands each call its prepared result once (104 s -> 44 s). ratecheck: its four phases start at once (91 s -> 28 s). `DMCHECK_SERIAL=1` restores serial.
Pitfalls: heredoc `\n` in node-written templates; `git show origin/main:path` needs MSYS_NO_PATHCONV=1 on Windows bash.
