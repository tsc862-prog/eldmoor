---
name: table-rescue-saves
description: #654 death slice 2a rules - downed at the Table and in crawl rooms, saves per round, rescue scene on a world downing, why each choice
metadata:
  type: project
---

Slice 2a of the death epic (#626, after slice 1 #673). Rules added and why:

- **goDown no longer refuses inside a scene.** A member at zero in a combat scene stays in sc.ids, downed. PvP (hero killer) still finishes, and the abstract background Crypt still kills (hidden/dungeon) - the crawl has its own `crawlDown`.
- **Saves per round, not per clock** (owner answer 2): `savesAtTable(sc)` (combat kinds with rounds, and `crawl`) makes the world's `downStep` skip saves; table.js `runTurns` rolls `tableSave` on the downed member's initiative turn (beat k:'save', check.kind:'death', rl kind 'death'). kin = anyone standing at the table (not distance), healer standing = 4 failures.
- **Scene extends while anyone bleeds:** `fightOver` is false while a member bleeds, round cap becomes `TABLE.DOWN_ROUNDS` 8. Without this a foe's fall would end the scene with the downed unattended.
- **World downing opens a rescue** in `due()` before the low-HP rescue: key `down:<id>:<down.at>` (one scene per downing), ctx.down=1, the killer mob as foe if alive within TR.REACH. Non-Fellowship companies only come to the table with a live runner (atTable), so `npm run sim` background companies keep the world clock; the Fellowship always gets the scene.
- **Foes on the downed at the table:** only when nobody standing is in the fight, or a `finisher` mob whose target is down (tableround `downTarget`). Bosses never pick the downed in rounds.
- **Crawl:** foes strike `standing(g)` only; nobody standing = wipe, `crawlLost` bleeds out the downed (`bleedOut`). Room-won breath does not lift the downed (only a heal does); ward mends only the standing. Leaving with someone down: `toWorld` after goHome/payClear (it checks a.down, not state, because goHome already changed it). dungeon.js and sites.js keep crawl-downed in g.mem (their filter dropped non-'dungeon' states). Death text keeps "felled by X in <dungeon>" via a.down.cause.
- Record: `C.crawl.downs`; sim summary prints "N fell, M downed".

**Why:** Fellowship deaths were mostly crawl deaths at once; rounds give agents a turn to act and companions a stabilize option.
**How to apply:** Watch mode clock and the DM's downed call are #655; agent tools/gambits #658. Check fixtures: downcheck section 7c needs `setRunnerLinks(()=>'connected')` plus a short TABLE.liveMs, else non-Fellowship companies never open scenes; reset links after. A rescue scene ending with hasLinks opens a debrief (fireside), so test `S.table !== sc`, not `!S.table`. See [[downed-saves]], [[table-rounds]], [[check_fixtures]].
