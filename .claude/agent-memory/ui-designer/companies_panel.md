---
name: companies-panel
description: #457 Companies panel in ui/fellowship.js - tab per company plus All, Start <company>, Companies only filter
metadata:
  type: project
---

The side panel (felbody, h2 "Companies") shows a tab per company plus All; no tab bar with one company (`tabSel`: null = followed, 'all', or id). `topView(node,C)` is generic: header, open threads (`company.openThreads(C)`), `hallBoard(C)` (dmfocus, via `focusOf(C)`), members drawer, fallen. Disband, camp line, Fill/Remove stay Fellowship-only (`C.slots`). Non-Fellowship members use `renderRoster`.

Runners: Fellowship keeps its one runner, button now "Start <name>"; other companies get `companyRunnerControl(C)` (runners.js) = hero runners per agent member (`startCompany`/`stopCompany`, data-runco, picker key `co:<id>`). A solo's runner is a hero runner. Never remove the stopall.

The campaign log in the Story panel follows the tab (All = merged, each line tagged). Chronicle filter "Companies only" = `companyFocus` in fellowship.js (Fellowship filter plus heroes of any company with an agent). The founding form is gone (setup-time only); no company shows a "start a New world" line.

**Why:** owner review on PR #406 wins; epic #402 row 20. **How to apply:** build new per-company UI on `companyview.js` and these functions, not S.fellowship.
