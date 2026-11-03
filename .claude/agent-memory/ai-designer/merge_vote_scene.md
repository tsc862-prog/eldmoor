---
name: merge-vote-scene
description: #500 - merge's paired proposal gets its own company's Table decision scene (queued behind the proposer's), keyed by propCompany(P)
metadata:
  type: project
---

The propose hook in table.js picks the company with `propCompany(P)` (the proposal's own company), not the proposer's. council.js `propose` calls the hook for P, then for its pair Q (`pairMerge` no longer reflex-fills Q itself). Since #518 ([[engaged-scenes]]) Q's decision scene opens at once beside P's (S.tables); `C.tableQ` (kind decision, `src:'pair'` only) is used only if Q's company already has its own scene open; `stale()` drops a queued decision whose proposal is no longer open. Hash-identical for default worlds (no merges).

**Why:** only the proposer's company got a scene; the other got a notification only.
**How to apply:** tests are in tablecheck `--companies` (g) and companycheck (caps 5 minds/8 heroes, companion re-point). See [[company_model]].
