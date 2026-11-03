---
name: dm-region-reads
description: #427 DM hooks/npcs take region as well as town; readScope resolver, scope/note reply fields, unknown-name refusal, dmcheck pitfalls
metadata:
  type: project
---

#427 (2026-11-02): DM reads `hooks {town?, region?}` and `npcs {town?, region?}` in `src/sim/dmagent.js` go through one resolver `readScope(tool, town, region)`.

- town first (exact, case-insensitive `townOf`), else region via `regionIdx` (name case-insensitive or index). A `town` that names a region is read as the region, reply carries `note: '"X" is a region, not a town: ...'`.
- Region scope = towns whose gate `zoneAt` is in it. hooks: jobs on those boards plus jobs whose `zone` leads into it. npcs: townsfolk of those towns; wanderers in those towns or standing in the region.
- Reply adds `scope: {region, towns}` or `scope: {town}`. Unknown name: refusal lists every region and town (names only). Read only: no DM log, no notes.

**Why:** the local DM asked hooks for "Lowmark" (a region) and got "No town called". The DM thinks in regions.

**How to apply:** other DM reads that take a town should reuse `readScope`. Pitfalls in dmcheck: on Eldmoor both towns sit in Thornvale, so a filter test needs a townless region (Mirefen) to show anything is filtered; `JSON.stringify(S.dmLog)` is circular (log parts hold hero objects), compare length and the first entry instead. Related: [[dm-flat-tools]], [[dm-agent]].
