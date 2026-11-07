---
name: table-foes
description: Why elites were soft in Table rounds and the rules added on the map patch (#1056): Defense once, swing clock, elite pace by members standing, tricks, heal gap
metadata:
  type: project
---

Table fights on a patch now grade like real time (#1056). All of it hangs on `sc.fp`, so seeded hashes hold; `npm run sim` reflex scenes keep the old rounds.

**Why:** three things made elites soft: Defense counted twice (AC and dmgTaken), the plain heal was 25% max HP every round against real time's 3.5 s gap, and hero class moves come round in rounds about six times sooner than in seconds. A slow foe (cd 2) was also paid a full blow every round, the other way round.

**How to apply:**
- A flat swing multiplier snowballs: at pace 1.5 fixed, a fight that loses two members kills three (19 deaths in 40). Pace proportional to members standing (`ELITE_PACE*up/5`) took deaths to 3% with the same downs. Keep it proportional.
- The old 12-round cap hid lethality: fights handed to the world at round 12. A fixed pace with cap 20 killed far more than with cap 12.
- Howl calling kin into the fight was tried and dropped: one L8 wolf took Greymane to 24% fights with a death. Elites do not call kin in real time either.
- Potions soften both paths alike (2 Redroot each: Greymane L7 downs 3% real time, 6% Table). The rows were tuned with no potions; balance rows should say which they mean.
- tablecheck pins `TR.ROUNDS_MAX`; the longer cap is only for `f.elite` on a patch, so ordinary test foes stay pinned. Related: [[table_rounds]], [[open_patch]].
