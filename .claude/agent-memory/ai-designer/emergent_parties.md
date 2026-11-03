---
name: emergent-parties
description: Epic #402 design (docs/emergent-parties.md, PR #406): companies of 1-8 replace the fixed five; the owner's decisions of 2026-11-03
metadata:
  type: project
---

Epic #402 (owner direction 2026-11-02): agent heroes may start apart, group up or stay solo. Design:
`docs/emergent-parties.md` (PR #406), sliced into issues (#438 = slice 1, the company model; see [[company-model]]).

Owner decisions (2026-11-03, review on PR #406 and its follow-up comment; they win over the doc):
- Unit is a **company**: 1..`PARTY.MAX` 8 heroes, at most `PARTY.MINDS` 5 agent minds per company (enforced in #455);
  5 paid / 10 local seats per world. Single-faction only (mixed = a later epic).
- **Together stays the default start, permanently**; "apart" is a setup preset. No default-world re-baseline.
- Only the followed company's Table scene pauses at 1x (a "pause for any company" setting).
- Replacement: seeded into the company (SEED_BEHIND 2) but arrives via a DM-narrated `arrival` Table scene; a dead
  solo's recruit starts at level 1 at home as a new solo with a short opening scene.
- Scripted companions allowed (reflex only, never lead). Solo jobs only while an agent company of one exists in that
  faction (keeps seeded hashes). No level gate on Crypt/raid; danger made legible instead. Follow: stop and say so.
- Hard-rule text rewritten in the last slice (12), not before.

**Why:** the fixed-five assumptions run through ~1,000 `fellow` references; one agreed model first avoids five agents
inventing five models.

**How to apply:** before coding any #402 slice, read the doc's section 0 (file map) and 13 (decisions); slice 1 must be
on main before slices 2+.
