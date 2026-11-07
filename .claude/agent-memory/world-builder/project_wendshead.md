---
name: project-wendshead
description: #1013 7e fifth and last chapter map (id wendshead, 160x76, levels 14-22): layout, Kiln and Grimbrand numbers, kragmaw-head template, hero level cap
metadata:
  type: project
---

`WENDSHEAD` in spec.js: Kilnmark (fac 0 tarrow, x0 44 y0 43), regions slagmoor 14-17 / kilnlands 16-19 / crownfell 18-22, the Brandwright Kiln (entry 14, rooms hit .35 .43 .52 .6, rounds 2 2 3 4), Coldwatch outpost, spring pool x134, lair x148.5 with `boss:'kragmaw-head'`. `final:true`, one exit `west` the Kilnway (Weirgate `east` now has `to`).

**How to apply:**
- Heroes stop at 20 (gainXp), so LVL_CAP 22 never tapers XP here; 21-22 are mob and elite levels only.
- Kiln forced crawls L14-20: 10-20% driven back, 0.05-0.13 deaths a run. The boss room (rounds 4) and the Quench Pool (rounds 3) drove most back; hit x1 of the first guess (2.1x the Vale) was 55-70% driven.
- Grimbrand `fixLvl 21, scale 10, hit 4, ready ['slam']`: real time L14 full 12/20 fights with a down, L17 3/20, L20 0/20.
- Kragmaw raid (real-time, five heroes): Eldmoor's row died in 25-45 s with 0 deaths at L14-20. Template `kragmaw-head` 26000 hp, blows x1.5: L16 43% killed, L18-20 about 58%, about 0.1 deaths a raid, failures break off.
- Harnesses in logs/tmp: dtrial, strial (ZN env, ELVL), raidtrial (HPX, HITX, SIZE).
- initiatecheck on `ELDMOOR_WORLD=wendshead` fails its three faction-muster cases (a lore world has no muster); the default run passes.
- Vite needs `--host 127.0.0.1`, and must be started in the same shell call as the shot script.
