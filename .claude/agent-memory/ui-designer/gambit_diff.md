---
name: gambit-diff
description: #679 gambitDiff/ownRule in sim/gambits.js, Agent tab marks, Stats summary, sheet Agent row; Bash heredocs halve backslashes
metadata:
  type: project
---
#679: `gambitDiff(a)` in src/sim/gambits.js (read-only, no RNG) matches the hero's rules to `presetFor(a.cls)` by identity,
then same id, then same when/and/then; statuses same/added/changed/off, `moved` up/down (outside the LIS), `dropped`,
`safety` {flee|potion|defend: off|gone|weakened}, `summary`, `edit` (last gambitHist entry naming the rule since a reset).
`ownRule(a,id)` feeds the purpose line ("by its own rule #id"). UI: `gambitBlock` + exported `gambitSummary` in
src/ui/agent-tab.js (li data-k g<id>/gd<id>, .gbm mark, title hovers), Stats tab line in panels.js, sheet row key
`gambits` group Agent. Checks: gambitcheck "#679" section, uismoke block before "Keys 1-5".

Gotchas: a safety edit writes the persona history, which breaks uismoke's Life empty-state check unless restored.
The Bash tool halves `\\` inside heredocs (python '\\n' became a real newline in JS); write code with Write/Edit instead.
Browser check: copy scripts/shoot.mjs to the scratchpad, `createRequire('<worktree>/package.json')('ws')`, then
`await import('/src/sim/gambits.js')` in Runtime.evaluate on the dev server (same module instances).
