---
name: honour-duels
description: #633 challenge/answer_challenge in sim/challenge.js; duel scene kind with ctx.ids actors, HP floor so no downing, scripted answer by hash, leader swap, check pitfalls
metadata:
  type: project
---
Honour duels (#633) live in `src/sim/challenge.js` (tools `challenge`, `answer_challenge`; scene kind `duel` registered with setSceneKind).

- **Two actors from any companies**: table.js `open()` takes `ctx.ids` (one-line edit) so a kind can name its own actors; the scene sits on the challenger's company (soloFor if none). sceneOf finds a hero by sc.ids, so a target from another company still answers with scene_act.
  **Why:** memOf(F) seating would have pulled the whole company in. **How to apply:** reuse ctx.ids for any future two-person scene.
- **Never downs (#626)**: every blow floors at DUEL.FLOOR (10%) of max HP; yield at TR.YIELD 30%. No strike() call (it can kill/down).
- **End of a duel mid-round**: apply() sets `sc.i = ids.length-1` so take()'s `sc.i++` skips the other's turn; next() returns false once ended.
- **No table** (Watch mode, or a non-Fellowship company with no live runner: atTable false): fought at once by reflex (fightOff), same options and dice.
- Scripted target answers by `hash(by,to,day*7+id)` vs boldness/honour/bond, never rnd(); only agents issue, so hashes do not move.
- A leader beaten by a companion in the same walking party: P.leader = winner (only when a party exists).
- DUEL.HIT 1.5 so yields happen inside TR.ROUNDS (3); otherwise decided on points or a draw.
- Check pitfalls: restore() replaces hero objects (do mid-duel save last or re-look-up heroes); raising a hero's lvl raises maxHp (makes it "too hurt"); the Fellowship walking party only forms in town (muster), so set members to town and step before a leader test.
