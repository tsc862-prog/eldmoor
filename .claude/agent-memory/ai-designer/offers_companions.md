---
name: offers-companions
description: #442 (epic #402) invite/accept/decline, join_party toward agent heroes, scripted companions - where offers live, why the Fellowship is refused, hash safety
metadata:
  type: project
---

Issue #442 (branch ai/invite-accept): `src/sim/offers.js` holds the grouping verbs; `player.js` only has thin handlers
(`invite`, `accept`, `decline`, one line in `join_party`). Builds on [[company-model]] and [[council-company]].

Rules chosen and why:
- **Offers live on the maker's company** (`C.offers [{id, kind:'invite'|'ask', from, to, until, text}]`, ids from
  `S.offerSeq`, `PARTY.OFFER_MIN` 60). An `ask` is join_party toward an agent hero or a companion: it goes to that
  company's leader, who must be within `OFFER.JOIN` 6 (keep equal to `PK.JOIN`) and hear it said aloud.
- **The offer is said aloud with `speak`** (earshot hears it), the agent invitee gets `ev(...,2)` (urgent, starts its
  turn). Nobody is forced: an unanswered offer lapses in `companionTick` and the maker hears "did not answer".
- **Scripted invitee answers by `hash(a.id,b.id,day+7)`** against `OFFER.CHANCE` .6 (.45 when 2+ levels above);
  loner, gap > 3, own party, own adventure (`b.adv`) or a grudge with a member decline by reason. Lines in
  `data/companions.js`, picked by hash. Spoken aloud only when `S.worldVoice!=='dm'` (default is 'dm', so the inviter
  reads the answer in the tool result).
- **Companions**: `b.companion=C.id` plus `b.company` and in `C.ids`. Reflex play = the scripted rules following the
  company party. `companionTick` (index.js, after fellowshipTick) musters a company party like fellowship.js `muster`,
  pins `P.leader` to an agent each step, holds companions at the gate (`wait`) while the leader is in town, and releases
  every companion when no agent member is left. `leaderOfC` skips companions; `seekParty` skips them.
- **Any company of 2+ (agents too) now keeps a walking party**; agents in it need `partyOk` (accept sets it). An agent who
  `leave_party`s (partyOk false) is not pulled back.
- **The five-slot Fellowship is refused** both ways ("five sworn places"): `fellowship.js` rebuilds `F.ids` from slots on
  join/leave/death (it would drop companions) and the `a.fellow` getter would make a companion a Fellowship member for
  ~150 readers. Lift this when slots go (slice 12).

Hash proof: git archive of origin/main 8b9c814; professioncheck/actcheck/wakecheck --hash 2890548967 / 1733832012,
tablecheck --hash 1607308129, --hash-talk -1443423032, crawlcheck --hash -1550190454, focuscheck 1606329989; all equal.
Nothing runs unless an invite happens: no RNG, no uid, no new S keys in a world without offers.

Check pitfalls (companycheck): `take()` from a pool must mark heroes used; place heroes then `rebuild()` (spatial grid)
before an earshot test; force candidate traits/level and let the hash pick who joins.

**How to apply:** dismiss, leave for_good, merge and expel (#443-#445) build on `release()`, `joinInto()` and `walk()`.
