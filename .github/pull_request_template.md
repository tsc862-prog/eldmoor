## What changed

<!-- One or two sentences. Link the issue: Closes #NN -->

## Area

<!-- world | creatures | characters | ai | render | ui | lore | balance | infra -->

## Patch note

<!-- Required (issue 664): add docs/patchnotes/<this PR's number>.md. Front matter (title, date, area, issues), then
1-6 "- " lines for the owner as a player: what he will see or can do in the game now, in plain words. No file or
function names, no hashes, no code. "Nothing you will notice: ..." is fine for CI, tests and baselines. Open the PR
first to learn its number, then push the note. A PR that truly needs none carries the label no-notes. -->

## Checklist

- [ ] Only files in my area were edited, or the exceptions are listed below
- [ ] `npm run sim` ran and the summary still looks sane (paste the key lines)
- [ ] New names, places, creatures or items are recorded in `docs/LORE.md` and are original (no Blizzard IP)
- [ ] Balance-sensitive change: `npm run sim -- 120` numbers included
- [ ] `docs/patchnotes/<PR>.md` written for the player (or the label `no-notes`)

## Sim summary

```
(paste)
```

## Out-of-area edits

<!-- none, or list file:reason -->
