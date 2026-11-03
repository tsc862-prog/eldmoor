---
name: council-company
description: #439 (epic #402 slice 2) council, reach and camp per company - solo refusals, leader rule, unique prop ids, solo camp rules, why hashes hold
metadata:
  type: project
---

Slice 2 of epic #402 (issue #439, branch ai/company-council): `council.js`, `reach.js`, `camp.js` work on the hero's
company (`companyOf`), ticked over `companies()` in id order. Builds on [[company-model]]; design in [[emergent-parties]].

Rules chosen and why:
- **Leader = the company party's leader, else the highest level (first in C.ids on a tie)** (`leaderOfC`). Not the doc's
  `leaderOf(C)` (level, bonds, id): today's Fellowship rule kept so the seeded together world does not move.
  `leaderOfF()` with no argument still means the Fellowship (old callers in table.js, staged.js, checks).
- **Solo**: `propose` refused with `SOLO` ("You ride alone: decide and act ...") except break_camp; `vote`, couriers and
  meeting plans refused too. A solo leads itself, so `break_camp` and `rest {hours}` just work.
- **Proposal ids unique across companies** (`nextPropId`: one past the highest `propSeq` any company used) because table
  scenes and `vote` name proposals by id. `openProps()`/`propById(id)` without a company search every company;
  agent-facing calls pass the hero's company so no one hears another company's votes.
- **Only the Fellowship's proposals open a Table decision scene** and only its camp ambush opens a scene, until #440
  (table per company). Keep that guard (`F===S.fellowship`) until #440 replaces it.
- **Camp**: `C.camp`; `minCamp(C)=min(3, places)` where the five-slot Fellowship counts its 5 slots (empty too), so a
  Fellowship down to 2 still never camps (hash). A solo camp (`g.solo`) heals at `SOLO_HEAL` .6, sleeps on odd
  watches, and an ambush then counts as caught (the Perception roll is still made: no RNG added). **Solos never
  auto-camp** at night, only on `rest {hours}`: auto-camping froze agent solos and broke playcheck's move_to tests.
- `unitDraft`/`cryptHold`/`raidReserve` treat any company of 2+ (or the Fellowship) as one unit; fill-ins exclude unit
  members. Level filters untouched (#449 removes the level gate).
- Import order: council.js keeps `import './fellowship.js'` as a bare import. Dropping it reordered the module graph and
  staged.js hit table.js's TDZ (`Cannot access 'EXTRA' before initialization`) in every script.

Hash proof (git archive of origin/main 34323a2 into the scratchpad): tablecheck --hash 1607308129, --hash-talk
-1443423032, professioncheck/actcheck --hash false 2890548967 / true 1733832012, focuscheck 1606329989, crawlcheck
--hash -1550190454; all equal on the branch.

**How to apply:** new per-company council/camp state goes on the company; tests for council per company live in
campcheck (tablecheck left to #440 to avoid conflicts).
