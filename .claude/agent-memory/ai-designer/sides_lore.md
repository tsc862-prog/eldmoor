---
name: sides-lore
description: "#1025 factions as lore: loreSides, sameSide, ownTown, foeOf, mayFight, sidesOff, raidSide; what each gate means and why fac stays"
metadata:
  type: project
---

`S.setup.sides==='lore'` makes Concord and Warband peoples, not sides. The setup page sets it on every new world; `defaultSetup` does not, so seeded checks and hashes never see it. It does not imply `others:'none'`.

**Why:** owner, 2026-11-06 (#1012, #1025): the game is D&D first; hide and stop feeding the faction systems, delete later.

**How to apply:**
- Helpers live in `state.js`. `sameSide` opens company verbs, `ownTown` opens town services, `foeOf` is the only test of who fights unasked. `sameSide` is true for everyone in a lore world, so never use it to ask "is this a foe": use `foeOf`, or `mayFight` for an agent's own choice.
- `foeOf` in a lore world: background vs background reads `fac`; two company heroes never; company vs background only if the other is `summoned` and of the other fac from `C.fac` (not the member's own fac, or a mixed company would split).
- `sidesOff` gates nemesis, grudges, rivalry heat and honour credit. Honour is still counted elsewhere, because hashes read it.
- A lore setup's hero fac follows its people, so a company can mix. Anything keyed on `a.fac` inside a company is a bug waiting: moves, kin, bonds and the raid pool all had one. A raider reads `raidSide(a)`.
- table.js has its own `foeOf(sc)`: the state one is imported there as `sideFoe`.
- Hero text differs only through `toolsFor`, `ordersFor`, `status.sides`, `dm_status.sides`; a world with sides must get the same array and strings.
- Friendly non-home towns still have no `list_jobs` or couriers; that is the old rule, left alone.
