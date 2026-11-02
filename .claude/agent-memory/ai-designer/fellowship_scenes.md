---
name: fellowship-scenes-issue325
description: #325 why the Fellowship lost scenes after bounties (5-member party never fit a size-3 job) and the rules added - ff jobs fit the whole Fellowship, are theirs only, hall keeps one on top, bounty becomes their job at the gate
metadata:
  type: project
---
Root cause found for the #67 scene drop (issue #325, 2026-11-02): every adventure template has `size` max 3, and the
Fellowship rides as one party of 5, so `fits()` refused every job on the board, even the #165 Fellowship-first (`h.ff`)
ones. The Fellowship only got adventures when its party happened to muster with 3 or fewer. Before #67 the kill quests sent
it home more often and in pieces; after #67 it rode out on bounties (176 of 274 gate departures per 120-min run had a bounty,
54 an adventure).

Rules added in `src/sim/dm.js`:
- An `h.ff` job fits a party with a Fellowship member at any size (the size cap is for background parties), and only such a
  party: background heroes cannot take it. **Why:** in a first version background heroes at the hall grabbed the ff jobs.
- The hall board keeps one ff job on top of a full board (`refill`, only while the Fellowship has nothing under way).
- `fellowHook` falls back to `bountyHook`: a captain's writ (templates whose givers include the captain) in the region of
  the Fellowship's posted bounty, `data.bounty` = the bounty id; the bounty stays posted for everyone.
- At the gate (`heroes.js`, after `dmDepart` fails) a Fellowship leader calls `fellowBounty(a,c,tz)` before
  `chooseBounty`; it posts the bounty job only when no ff job is open, then `dmDepart` again.
- All of it is gated on `focus()` or `a.fellow`, so `ELDMOOR_FELLOWSHIP=0` rolls exactly as main (hash checked).

**Measured** (b325 harness, 12 seeds x 120 min, reflex Fellowship): non-crawl Fellowship scenes (ambush+check+rescue+elite+
choice) 64.6 -> 120 a run (+86%), all scenes 289 -> 377 (+30%), adventure scenes 32 -> 91; background deaths 14.7 -> 14.8;
Fellowship fallen 0.67 -> 0.17. Side effect: Fellowship mean level at 120 min 16.8 -> 18.3 (adventure XP is per member, not
split). If that is too fast, scale ff adventure pay by 3/party size before touching PAY_XP. Related: [[bounties-issue67]],
[[dm-adventures]], [[table-rounds]].
