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
- #483 (slice 2) left `F===S.fellowship` guards for #440; replaced: council.js calls the propose hook for any company
  (the hook opens the scene for the proposer's company), camp.js opens the camp ambush scene for any company
  (`openScene(...,{mob},F)`, the Fellowship's frame text unchanged). campcheck now expects the pair's vote scene and a
  solo's camp-ambush scene, and settles them with Table off + `tableHold(0)` so no world time passes.
- A solo's adventure **choice** stays on the per-hero pick flow (`choose`, `CHOICE_HOLD`, then the scripted branch):
  it already is a one-answer waited choice, and routing it to a Table scene broke playcheck's silent-agent timeout path.
  Only the Fellowship's choice goes to the Table (player-choice.js still gates on `a.fellow`).
- `status` shows `table` for any hero (player.js one-liner); save.js v6->v7 stamps an open table with the Fellowship id.
- **Only companies with an agent that has the say come to the table** (`atTable(C)`: the Fellowship always, any other
  company only while `agentsDecide(members)`: a runner holds a member, or its runner is gone and the owner is asked).
  A runner-less company plays on by its autopilot, as with the Table off, and spends no cooldown key. Why: a
  reflex-only solo scene swapped #491's cautious autopilot (native prey, break off at 22%/50%) for the table's reflexes
  and stopped the clock for nothing; townpilotcheck's silent level-1 solo then never reached level 2 in 24 game hours.
- playcheck runs with `TABLE.mode='off'`: its mock agents hold runner claims (so they would get scenes), `wait` is
  refused on your own turn, and the pause shifted the seeded trajectory (its hero met a Cinder Golem and died).
  lorecheck needed no change once runner-less solos stopped getting scenes.
- `bannerOf()` carries `company, companyName, solo`; `decisionsWaiting()` entries carry `company` (UI use is #471/#458).

Testing pitfall: a solo in a duel with an enemy hero opens an ambush right after its rescue resolves (key `duel:<id>`);
reset the duel before the next case. tablecheck `--companies` child covers solos, the queue, a pair, the refusal.

**How to apply:** #458 (followed-only pause, banner) and #441 (crawl) build on `sceneCompany`/`sc.company`; move
`S.table` to `S.tables[]` only there, keeping the company-id tick order.
