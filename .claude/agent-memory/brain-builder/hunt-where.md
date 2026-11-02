---
name: hunt-where
description: #411 hunt {where}: reuses move_to's plan(), queues [move, hunt], huntGrounds nearest-known helper, k0 set lazily, zonePoint enemy-wall retry
metadata:
  type: project
---

#411 (PR #420): `hunt {where}` resolves via `plan()` (same as move_to, #399/#404), queues `a.pq=[move, hunt]`; the hunt cmd's `k0` is set when field() first runs it (kills on the walk don't count), and the playOrder hook finds the hunt with `pq.find`. `huntGrounds(a)` ranks known regions by nearest ZPTS point (sampled, no RNG) for refusals.

**Pitfall:** `zonePoint` uses RNG; Thornvale surrounds both towns, so move_to/hunt to it failed at random with "under an enemy town wall". plan() now retries up to 8 picks. In playcheck, "X Webspinner Grounds" style names resolve to X via placeFallback, so use a truly unknown name for refusal tests.

**How to apply:** for seeded-hash proof without touching E:/eldmoor, `git archive origin/main src scripts package.json docs | tar -x -C <scratch>` and run `node scripts/professioncheck.mjs --hash` in both. Related: [[tool-quickwins]].
