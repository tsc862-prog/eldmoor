---
name: interrogation-camp-scene
description: #431 slice 3 - interrogation scene kind (interrogate.js), yield queue, staged suspect bridge via table.js kindHooks/stageDone, camp scenes as an outdoor cut (ctx.camp), test pitfalls
metadata:
  type: project
---

#431 slice 3 (2026-11-03). `src/sim/interrogate.js` registers kind `interrogation` (PLAY 'turns', IQ.ROUNDS 3, `everyBeat`
so its DM onBeat runs every round, not just round 1 - a table.js kind flag). Options ask/threaten/bargain/read/release/
hand_over/watch; d20 vs resolve: pass = truth (learnPlace + memory + note tagged interrogation), miss by <=4 = lie (once),
worse = silence; failed threat +2 DC; read catches a lie. DM voices each answer through arrival.js's voice kit
(voicedKind), told the dice result; reflex fill is "Name: ..." so the bubble sits on the suspect.

**Why these rules:**
- A yield (sc.end==='yield' in elite/ambush/rescue) queues C.iqQ only with hasLinks()+agentsDecide, like the fireside, so
  npm run sim and every seeded hash stay identical (hashcheck all equal). Only the DM staging can open one without a host.
- staged.js must NOT import interrogate.js (import cycle player->talk->staged->interrogate->arrival hits TDZ on VOICED).
  Bridge through table.js: `kindHooks(k).stagedCtx` (staged asks the kind for its ctx) and `stageDone(sc)` (the kind's DM
  done closes the staged record). Keep that pattern for any new kind with its own DM voice.
- Camp scenes stay on the real terrain (owner: outdoor matches the landscape): `OUTDOOR_SETTINGS.camp` in data/settings.js,
  ctx.camp {x,y} on the camp ambush (camp.js) and fireside; sceneview frames a 13x9 cut on the fire; render/camp.js keeps
  the fire and left bedrolls drawn while a scene at that camp lasts (the ambush broke the camp).

**How to apply / pitfalls:** checks with setRunnerLinks(()=>'connected') that end fights by yield must set
`IQ.ON=false` (tablecheck --parley does). Non-combat 'turns' scenes have no sc.rd until round 2 - set sc.rd=1 at open.
Python on this machine (WindowsApps) silently failed to write files and turned "\\b" into 0x08: edit with node or Edit.
Screenshots: drive Chrome over CDP against your own vite port; a fake npc needs a real fac (npcSprite reads FAC).
Related: [[fireside]], [[table_rounds]], [[engaged_scenes]].
