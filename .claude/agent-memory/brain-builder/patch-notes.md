---
name: patch-notes
description: #664 patch notes protocol - docs/patchnotes/<PR>.md format and lint, rulescheck rule 6 + no-notes label, launcher last-seen, title What's new, back-fill via subagents
metadata:
  type: project
---
Patch notes (#664, PR #668, 2026-11-03): every PR adds `docs/patchnotes/<PR>.md` (front matter title/date/area/issues, then 1-6 "- " lines for the owner as a player). `0000-before.md` is the pre-rule summary (pr 0, dated a day earlier so it sorts first). Files starting with `_` are skipped.

- Parser + lint shared by all users: `src/ui/patchnotes.js` (refuses backticks, file names, `x()` calls, camelCase, hex hashes, >280 chars, >6 lines; areas list there).
- Rule: rulescheck rule 6. On a PR, CI passes `PR_NUMBER`/`GH_TOKEN`; the merged tree (CI checks out the merge ref) must hold `<PR>.md`, else label `no-notes` read live via `gh pr view` (re-run the core job after labelling). A note for PR N can be added by another PR (back-fill worked that way).
- The PR number is only known after `gh pr create`: write the note under a placeholder, open the PR, then `git mv` it to `<PR>.md` and push.
- hash-guard comment = `node scripts/patchnotes.mjs --quote N` + hashes.md.
- Launcher: `unseenNotes(REPO)` on start and after `u` reads/writes `<repo>/logs/last-seen.json {commit, at}`; order = `git log --first-parent` merges, PR from "Merge pull request #N" or "(#N)"; `n` = last 10; `npm run notes -- --since/--last/--lint/--quote`.
- Title: `provideNotes(glob)` from main.js; read ids in localStorage `eldmoor.notesSeen {ids, commit, at}` (`__COMMIT__` Vite define); unread newest first, 3 open, fold, NEW badge until Got it or leaving the title.

Pitfall: in this Bash tool, backslashes inside heredoc'd Python got eaten (`'\n'` became a newline, `What\'s` lost its backslash); use the Edit tool for any string with backslashes.
Back-fill of ~110 notes went fast with 5 parallel Sonnet general-purpose agents given a brief file (format, rules, lint command).
