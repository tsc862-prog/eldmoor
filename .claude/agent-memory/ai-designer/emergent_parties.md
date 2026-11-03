---
name: emergent-parties
description: Epic #402 design (docs/emergent-parties.md, PR #406): companies of 1-8 replace the fixed five; the owner's decisions of 2026-11-03
description: Epic #402 design (docs/emergent-parties.md, PR #406): companies of 1-8 heroes (5 minds max), owner decisions of 2026-11-03 and the 12-slice plan
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
Epic #402: agent heroes may group up, split or ride solo. Design: `docs/emergent-parties.md` (PR #406, docs only).
Owner decided section 10's questions on 2026-11-03 (doc section 13 lists them):
- **Company** is the word; a solo is a company of one; every agent hero is in exactly one company. "Fellowship"/"pack" stay as `NAME_PARTS` names.
- **Two caps**: `PARTY.MAX` 8 heroes, `PARTY.MINDS` 5 agent minds; extra slots only for scripted companions. Pacing/cost follow minds; crawl and staged foe counts scale with heroes (`scaleFoes`, five = today's numbers).
- **Single-faction** only; mixed companies are a later epic (enemy towns refuse, guilds call them deserters).
- **Together stays the default start permanently**; "apart" is a setup option with presets (five-solos, pairs-and-solo). No flip PR, no default-world re-baseline; one `companycheck` covers apart.
- **Pausing**: at 1x only the followed company's scene pauses; others run on the live clock with normal agent waits, banner line switches the follow; one-scene queue per company; "pause for any company" setting.
- **Replacement**: seeded into the company (SEED_BEHIND 2) but arrives in a DM-narrated Table scene kind `arrival` (PLAY 'all') at the next camp or town, never mid-Crypt; oath at the table; DM agent voices it if seated.
- **Seats**: 5 agent heroes if any mind is paid, up to 10 if all local (turn-time warning); DM outside the count.
- **Scripted companions** by invite (traits, hash, no RNG): reflex play, never lead/speak beyond barks, leave on dismiss/split/dissolution; their deaths follow guild grudge rules and are not refilled into the company.
- **Solo jobs**: every board keeps one solo-sized, band-checked, lower-paid job; DM stages better on top.
- **Follow**: stop and say so (urgent "lost them"; followed hears "X has fallen behind"); autopilot keeps pace while following.
- Additions: **no level gate** on crypt/raid proposals (danger legible: stair sign, gate captain, lore stair read, DM framing, proposal line; a passed proposal drafts a green company, fill-ins keep level filters); **DM treats every company as a thread**, followed company first.
Open points sent back to the owner (not resolved): hard-rule wording for scripted companions and followed-only pausing; a solo's death (no one to seed under or greet); 5 minds per company vs 5/10 seats per world reading; solo jobs moving seeded board hashes.
**Why:** the fixed-five assumptions run through ~1,000 `fellow` references; agreeing the model first stops five agents inventing five models.
**How to apply:** before coding a #402 slice, read the doc's section 0 (file map) and section 12 (12 slices, owners, order: slice 1 alone on main first). Never reintroduce a default-start flip or a level gate on crypt/raid proposals.
