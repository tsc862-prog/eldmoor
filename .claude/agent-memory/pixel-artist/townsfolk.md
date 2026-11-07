---
name: townsfolk
description: #832 LPC townsfolk sheets - one per NPC role and people, how they are made, drawn and looked at
metadata:
  type: project
---
- `scripts/art/lpc-townsfolk.mjs` + `lpc-townsfolk.json` on the #809 pipeline: ids `sprite:npc-<role>-<people>`, roles looped from
  `NPC_ROLES` + `WANDER_ROLES` (data/npcs.js; the script fails on a role with no look), people look from lpc-heroes.json.
  Layer extras: `fac` (layer only for that faction), `variant` as {fac: v}. `ELDMOOR_PACKS=<packs dir>` points at a packs folder
  outside the checkout (worktrees have none; fetched set is sparse: no gloves, backpacks, polearms, oversize weapons, beards).
- Renderer: `sprites.js` `npcSheetId(role,race)` (people, then role-only, else null) and `sheetFrame` takes kind 'npc'; draw.js and
  places.js (DM wanderers) use it; idle townsfolk face down. #795's guards: add `sprite:npc-guard-<race>` to the index, no code change.
- Looking: vite on 5902 with a scratch config (cacheDir in temp), `?continue=1`, `ensureNpcs()` from sim/npcs.js (S.npcs is lazy),
  teleport npcs to `p.post` and `state='post'`, map view setZoom(2.6). The world's Fellowship faction is random per boot.
- A `python3` on this machine is a Windows Store stub that hangs waiting on stdin: never use `python3 -` in a shell chain.
- Overlapping `npm run artcheck` runs share temp dirs and can report a false FAIL; run it alone.
