---
name: companies-initiate
description: #826 - the world engine never asks a company into the Crypt or a raid; inMuster keyed on hasLinks, solo orders, askCompany seam for the DM's call_to
metadata:
  type: project
---

Owner decision 2026-11-04 (#826): companies initiate the Crypt and raids. `inMuster(a,kind)` in council.js gates both background pools. With a host (`hasLinks()`) no company member or agent hero is in a pool, unless its own raid vote passed (`C.accept.raid`). With no host `inMuster` is always true: the old reflex draft stays, so seeded hashes hold. Leaving no-host solos out too moved hashcheck's autopilot row (its agent heroes are solos), so the player.js guard stays reachable there.

Rules and why:
- Keyed on `hasLinks()`, not on "every member reflexMay": a hosted company whose runners are gone (owner resumed, play-headless with no runner) must not be sent in by reflexes either. The hard rule says reflexes never send an agent company.
- The raid vote still goes through unitDraft: the muster is what takes them, so accepted companies stay in the pool. The Crypt vote goes straight through `cryptGo`/`goCrypt`.
- A hosted raid vote that never musters lapses in councilOne when `C.accept.raid` runs out (240 min), since nothing reopens it any more; otherwise `C.wait.raid` idled the faction's reserve for 240 more.
- `go_crypt` walks to the mouth first: musterCrypt from afar would disband at `g.t<=0` with fewer than 3 there. The `crypt` command stays at the head of `a.pq` while waiting; dropping it (any new order) clears `C.wait.crypt` in councilOne.
- No level gate on solo orders (#449), a warning via greenWarn. `join_raid` needs a muster out; a solo in an `others: none` world therefore has no raid.
- `askCompany(C,kind,{src,caller,details})` is the seam for brain-builder's `call_to` (src 'dm'): `P.caller` is named in the notice, log and decision frame; a caller also skips the "everyone together" refusal, as src 'call' does.

**How to apply:** checks that want the reflex draft must `setRunnerLinks(null)`; a link function returning 'none' counts as a host. Related: [[no-level-gate]], [[others-none]].
