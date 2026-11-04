---
name: multi-dungeon
description: #891 several spec dungeons: CRYPTS, crypts.js as the one reader, first-dungeon-writes-nothing rule, cryptFor choice, entry level, Cairn boss rounds
metadata:
  type: project
---

Every crypt landmark is a record of `CRYPTS` with its own group and cd; `CRYPT` is `CRYPTS[0]`. `src/sim/crypts.js` is the one reader of which dungeon a group, hero, scene or vote belongs to.

**Why:** the Hollow Cairn (#717) had rooms no group could enter. Owner's rule: loop over tables, and a one-dungeon world keeps its seeded hashes.

**How to apply:**
- A new field that names a dungeon is written only when it is not the first (`ctx.dun`, `P.dun`, `F.waitDun`, order `dun`, via `cryptCtx`), and a group is found by scanning `CRYPTS`, never by a field on the group. That is what keeps Eldmoor's hashes.
- New reader of "is this hero below ground": `cryptOfHero(a)`, not `CRYPT.group`.
- Background choice has no dice: nearest dungeon whose `entry` the level meets (`cryptFor`); a company as its leader; a delve oath its own dungeon. Nearest beat "hardest earned" because the gather window is 30 s, and far groups disband.
- `needOf` lifts the abstract roll's bar with `entry`, so one spec field sets both.
- The Cairn's boss room has `rounds:3`: Warden 4 blows + shambler 2 = 6, and reflex parties never cleared it in 2 rounds (0 of 15, even at L22 gear 30). A room's blows must fit its rounds, or nobody clears it; probe a new dungeon's last room first.
- A later dungeon's crawl waits on `sceneFor(company)`, not `S.table`, so two crawls can run; the first keeps `S.table` for its hash.

Related: [[emergent_parties]], [[no_level_gate]], [[dm_sites]].
