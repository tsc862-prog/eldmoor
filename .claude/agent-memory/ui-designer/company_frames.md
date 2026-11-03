---
name: company-frames
description: #456 (epic #402 slice 19) company rows in the party frames, the follow cycle, sheet columns of the followed company, banner owner chip; src/ui/companyview.js is the shared read-only helper
metadata:
  type: project
---

Companies in the watcher UI (#456, PR for epic #402 slice 19). `src/ui/companyview.js` is the one UI helper over
`sim/company.js`: `followedCompany()`, `companyLabel(C)`, `companyCols(C)` (the five-slot Fellowship keeps
`fellowshipMembers()` with empty places; any other company `members(C)` with `slot:'h'+id`, role from `roleOf`),
`frameGroups()` (followed first; solos share one "Alone" row, first when a solo is followed), `followNext()`,
`followCompany(C)`. Frames, sheet, Life view, controls and the Table banner all read it; #457 (Companies panel) should too.

- Default together world = one row, row head hidden, title and "Compare the five" and vFel "Fellowship" as before.
  Banner owner chip (`tableOwner` in ui/table.js) only with 2+ companies.
- vFel: first click frames the followed company, each next click `followNext()`; `syncFollow()` in controls.js is
  called from `renderFrames` because syncView otherwise only runs on camera changes.
- Keys 1-9 count frames in display order across rows. `S.followId` is plain S, so it saves with the world, and the sim
  never reads it except `followed()` fallback, so switching follow moves no hash.
- The issue's chat item (shout shows company name) was left out of #456 by the caller's file scope; still open.

**Why:** the owner's review on PR #406 wins over the doc; together stays the default forever.
**How to apply:** new company UI goes through companyview.js; keep the one-company look unchanged. See [[stable-panels]], [[table-legibility]].
