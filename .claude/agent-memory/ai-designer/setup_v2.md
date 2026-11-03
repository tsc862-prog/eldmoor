---
name: setup-v2
description: #453 (epic #402 slice 16) setup v2 in sim/setup.js - together/apart, v1 migration, why together stays the five places, slotsView for the old page, hash proof
metadata:
  type: project
---

Setup v2 (#453): `{v:2, mode:'together'|'apart', fac, heroes:[{cls, fac, mind, start?:{town, region}, group?, ...}], dm}`.

Rules chosen and why:
- **Together = the five places for now** (any order; `slotsOf` maps heroes to tank/healer/dps1-3, first fitting free
  place). Only the five-slot company stands behind S.fellowship, so a together company of 1-4 would get none of the
  Fellowship machinery; validation says "Pick Apart for fewer". Revisit when council/table go any-size.
- **v1 migrates by index** (`asV2`: slots in SLOT_KEYS order -> heroes; raw, so validateSetup still sees bad values;
  `cleanSetup` cleans to v2). pickSetup iterates SLOTS with the same entries and `resolveArchetype` hashes the hero
  index (= slot index for v1), so the together world is byte-identical. S.setup of a together world is unchanged
  (no `mode` key); apart adds `mode:'apart'`.
- **Apart** (`openApart` in opening.js): pickApart, season the others (same `seasonOthers` as together), then per
  group: place in the first member's start town, season to `start.region` band low (relocate into that region if
  zoneFor picked another), `foundCompany` BEFORE `markPlayer` (so soloFor finds the company, no throwaway solos).
- **The page still edits v1** until #454: `slotsView(v2)` gives the five places back (null for apart); the page
  stores/queues v2 from cleanSetup. planRunners emits kind `company` for same-mind apart groups; runners.mjs has no
  such kind until slice 12.
- init() does not reset the world: building two worlds in one process stacks heroes. setupcheck builds apart worlds
  in child processes (`--facts`).

Hash proof: professioncheck --hash 2890548967 / 1733832012, tablecheck --hash 1607308129 and --hash-talk, setupcheck
SIGs (seeds 1, 2, 4242) and a full post-init snapshot hash of a v1 setup equal on main 5ae7bb6 and the branch.

Known, not caused here: runner-less agent heroes at level 1 (apart solos in `npm run sim`-style headless runs, or any
L1 hero marked agent on main) all die within ~1.5 game days on autopilot, while scripted L1s mostly live. Real play
has runners; worth an issue on autopilot caution for low levels.

**How to apply:** keep new setup fields per hero, iterate heroes by index, and never let the together path consume
different dice; compare against a git archive of origin/main with the hashes above. See [[company-model]],
[[emergent-parties]], [[new-world-setup]].
