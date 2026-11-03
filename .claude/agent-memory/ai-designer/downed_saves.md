---
name: downed-saves
description: #626 slice 1 (#652/#653) downed.js rules - why hero blows still finish, why table/crawl keep instant death, aid state, finishes flag, test pitfalls
metadata:
  type: project
---

Downed and death saves live in `src/sim/downed.js`; `agentDie` asks `goDown` first and `slay` is the only road to `fall` (2026-11-03, PR for #652/#653).

- A hero's blow on a hero always finishes (PvP unchanged until #657 brings spare/mercy). **Why:** keeps PvP deaths and honour identical in slice 1. **How to apply:** #657 changes `goDown`'s `killer.kind==='hero'` line, nothing else.
- `goDown` returns false inside `sceneOf(a)` (Table scenes) and in the Crypt (hidden/dungeon); the crawl calls `fall` directly. **Why:** the rescue scene and crawl downing are #654; mob blows at the table go through `mobBlow -> hurt -> agentDie`, so without the guard a table hero would lie downed while the table thought them dead.
- Helpers use a new `aid` state (not conditions in hunt): kin = party, company or guild of the same faction, from hunt/travel/follow/return/regroup only, healer preferred. Agent heroes aid as a reflex too (the issue's gambit preset "ally downed: revive_ally"; #658 moves it into gambits).
- "Nobody left to help" = three successes with no standing kin within 12 tiles -> dies alone. A natural 20 still rises.
- `beh.finishes` in the bestiary (wolf, rimehound, wight) keeps a mob on the downed; others turn to a standing hero who fights them or came to aid. Kragmaw's breath hits the downed.
- Balance (10x120 vs main): deaths/h 9.85 vs 10.5, Fellowship deaths 0.8 vs 1.4 per run, but only ~0.8 of ~4 downings per run get up: background heroes are mostly solo, and the Fellowship's deaths are crawl deaths that #654 must handle.

Test pitfalls: checks that call `agentDie` on a full-health hero to get a death now only down them; use `slay` (actcheck, lorecheck). The spatial index is rebuilt only in `step()`: call `rebuild()` after placing heroes in a fixture. Forced d20s via a Math.random queue only work if you step the downed alone (`downedStep`), since `step()` draws many dice. A stubbed-Math.random world diverges after ~25 sim minutes even on main (two init()s in one process), so keep determinism runs short.

Related: [[party-rules]], [[rebalance-issue107]], [[check-fixtures]]
