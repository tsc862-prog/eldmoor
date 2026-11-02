---
name: talk-range
description: #182 rules for party talk range, presence-bound councils, meeting plans, couriers, catch-up; why reflex parties are exempt and why there is no Party tag
metadata:
  type: project
---

Talking takes presence (#182, src/sim/reach.js, branch ai/talk-range): party_say is a shout heard within 12 tiles (weather shortens it), say stays 7. Proposals reach and count only members in range (P.absent); lead_to moves only those in range; crypt/raid need everyone together.

**Why:** owner wants D&D feel: split parties can't talk, so they must plan where and when to regroup. Couriers (paid, slow, from a town gate) were chosen over a message board or sending stones: one tool, costs gold, arrives as an event.

**How to apply:**
- `gathered()` in council.js exempts a party whose members are all reflex-played (headless sim, no runners): they move as one unit, so holding them to range would only stall Crypt/raid drafts and change baselines. 10-run comparison showed deaths unchanged within noise.
- Catch-up: the returner is never handed the missed facts (in-game channels rule #123); one present companion is told and asked to say them.
- The owner asked to drop the "Party" chat tag: party lines read "X shouts: ..." with a dim "(who heard)", or "X calls out, but no one is near". Don't reintroduce a channel tag. The dossier's Party *tab* is unrelated and stays.
- Determinism with a split Fellowship is checked in tablecheck (`--hash-talk` child). [[party-rules]] [[chatter-rules]]
