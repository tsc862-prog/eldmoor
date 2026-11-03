---
name: table-per-company
description: #440 (epic #402 slice 3) Table scenes keyed by company - sc.company, per-company queue, solo scenes, why the together hash stays put
metadata:
  type: project
---

Slice 3 of epic #402 (issue #440, branch ai/table-per-company). `S.table` stays ONE scene at a time; every scene
carries `sc.company` (a scene saved before it reads as the Fellowship's: `sceneCompany(sc)`).

Rules chosen and why:
- **Roster = the company.** `memOf(C)` is `fellows()` for the five-slot Fellowship (slot order, so its hashes and
  "everyone at once" order are unchanged) and `members(C)` (join order) for any other company. lowest/reflexFor/apply/
  outcome/nextRound all go through the scene's company. Per-company `tableSeq`, `tableSeen`, `tableStats`, `tableDm`.
- **tableTick = companies() in id order.** Queued moments open first when the table is free; then each company's
  `due(C,L)` (same rule order as before: rescue, boss, ambush, elite, Crypt, DM check). One scene opens per tick; a
  later company's due moment goes to `C.tableQ` (cooldown key kept). The company holding the table and a company with
  a full queue are not looked at (so a "third" moment never sets its key). A stale queued moment (older than
  `TABLE.queueMin` 30, member out of the fight, foe gone) is dropped and its key unset.
- **Determinism:** with one company (the together world) the busy company is skipped exactly as the old
  `if(S.table)return` did, and the seen() side effects happen in the same order, so every seeded hash is identical.
- **Solos** get every kind; `open()` with no company derives it from ctx.hero/anchor, else the Fellowship (camp ambush,
  crawl rooms, staged scenes stay Fellowship until their slices). `voteRefusal(C)`/`SOLO_VOTE` refuse a decision
  scene for a solo (non-slots company of one); council.js's own propose refusal is #439's.
- A solo's adventure **choice** stays on the per-hero pick flow (`choose`, `CHOICE_HOLD`, then the scripted branch):
  it already is a one-answer waited choice, and routing it to a Table scene broke playcheck's silent-agent timeout path.
  Only the Fellowship's choice goes to the Table (player-choice.js still gates on `a.fellow`).
- `status` shows `table` for any hero (player.js one-liner); save.js v6->v7 stamps an open table with the Fellowship id.
- Checks that drive agent solos but are not about the Table run with `TABLE.mode='off'` (lorecheck, playcheck): a
  solo's scene pauses the world (a live silent agent up to liveMs), `wait` is refused on your own turn, and the pause
  shifts the seeded trajectory (playcheck's hero then met a Cinder Golem and died). Answering scenes in the mock was
  tried and was not enough; switching the Table off keeps them on main's trajectory.
- `bannerOf()` carries `company, companyName, solo`; `decisionsWaiting()` entries carry `company` (UI use is #471/#458).

Testing pitfall: a solo in a duel with an enemy hero opens an ambush right after its rescue resolves (key `duel:<id>`);
reset the duel before the next case. tablecheck `--companies` child covers solos, the queue, a pair, the refusal.

**How to apply:** #458 (followed-only pause, banner) and #441 (crawl) build on `sceneCompany`/`sc.company`; move
`S.table` to `S.tables[]` only there, keeping the company-id tick order.
