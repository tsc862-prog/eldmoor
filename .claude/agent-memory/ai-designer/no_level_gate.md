---
name: no-level-gate
description: #449 - companies are never refused or filtered for level in Crypt/raid proposals and drafts; green warning text; hashes
metadata:
  type: project
---

Companies (any `companyOf(a)` hero) enter the Crypt and raid pools whatever their level (`dungeon.js` pool, `boss.js` pool); `cryptReady` and `unitDraft`'s `free` lost their 7/14 floors. Background (non-company) heroes keep `CRYPT_LVL`/`RAID_LVL`, so the ELDMOOR_FELLOWSHIP=0 hash (2890548967) is unchanged; the default-world hash moved 1733832012 -> 2425237100 in that PR only.
`propose` appends the #448 warning to `P.details` for a green company (lowest member below the target region's band low; `greenWarn` in council.js).
`reflexVote` still says no below 7/14: reflexes are a fallback judgement, not a gate, and it stops a reflex-only green Fellowship suiciding in sims.

**Why:** owner decision "no level gates" (docs/emergent-parties.md section 10); danger is made legible, agents decide.
**How to apply:** tests that needed "a member who cannot go" must use a state (ghost), not a low level (tablecheck did).
