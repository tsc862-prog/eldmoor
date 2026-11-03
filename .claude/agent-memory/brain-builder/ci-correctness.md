---
name: ci-correctness
description: #573 hashcheck.mjs (hash source, vs origin/main via git archive), rulescheck.mjs + allowlist, hash-guard job, merge_group, pitfalls
metadata:
  type: project
---

`scripts/hashcheck.mjs` runs 9 probes (the check scripts' own hash modes plus two in-file children `--child company|world`) here and in a `git archive origin/main` temp dir; hashcheck.mjs is copied into the base so both sides run the same probe code; base gets a node_modules junction (read only). Exit 2 = moved, 1 = probe failed. ~25 s with 4 parallel jobs. Windows msys tar: use `cwd: dir` with `tar -x`, not `-C <winpath>`.
`scripts/rulescheck.mjs` + `scripts/rulescheck.allow.json` (literals with a why, tables, layering, ciExempt [hashcheck]). Today's allowlist: faction enum 'concord'/'warband' in dmsight.js, levers.js, staged.js. Append-only compares keys by row name/id vs origin/main.
CI: `merge_group` trigger; `hash-guard` PR-only job comments the table (`gh pr comment --edit-last --create-if-none`) and fails on a move unless label `hash-change-ok` is on the PR (read live via gh, so re-run the job after labelling); `ok` accepts hash-guard success or skipped. sightcheck was a package script missing from ci.yml; now in the agents job.
**Why:** owner wanted hash claims in PRs to be one verified source, and the written rules enforced.
**How to apply:** new check script -> add the ci step or rulescheck fails; new seeded probe -> add to PROBES in hashcheck.
