---
name: attempt-ruling
description: #522 free actions - attempt tool, ruling_call/ruling_answer protocol, effect string grammar, wait rule, scene hooks, ruling voice, check pitfalls
metadata:
  type: project
---

Built 2026-11-03 on branch brain/attempt-ruling (PR "Closes #522"). Module `src/sim/ruling.js`, check `scripts/attemptcheck.mjs`.

- **Hero side:** `attempt {what, how?, at?}` (act). Refused only for form: empty/300+ chars, non-English, dead/hidden, fight states, inside a scene (points to `scene_act attempt`), `ATTEMPT.PER_HOUR` 3 (a.attempts, game minutes). Words said aloud via speak(...,'attempt'). Result inline when ruled at once, else `{call}` and the ruling arrives as urgent event (w=2) + narrator chat line + a `ruling` row in a.playLog.
- **DM protocol:** `ruling_call {budget_s}` (act:false; idle polls not logged in D.calls, relay, prep IDLE) -> `{call:{call, seconds_left, hero (class, level band, health words, best skills, gear, quest items), attempt, where, in_sight, legal{skills, dc, effects, effect_forms}, rules}}`. `ruling_answer {call, skill, dc word, effects[], fail_effects[], text, fail_text, note}`. Any illegal effect refuses the whole answer (logged, `forbidden` for level/HP/gold words); the scripted DM fills at the deadline. note stays in the DM log (channelcheck plants it).
- **Effect strings:** `kind[:target[:value]]` or `{kind,target,value}`: none, move:<dir n|x,y> (<=6, not in scene), reveal:place|fact|creature:<v>, attitude:<person>:<-3..3>, open_talk:<person> (Fellowship only), open_scene:<mystery|meeting|social|ambush|trap> (stageScene, its caps), item:give|take:<item> (pull give_item/take_item), wound:<1..15> (floor 10% HP), condition:warded|exposed:<min> (setEff taken .85/1.15; skipped if a taken eff holds), boon:d4|d6|d8 (a.boon, next attempt within 6 h).
- **Wait rule:** waits only if the ruling voice polled within POLL_MS 6 s and the seat is open; ms = budget_s or TABLE.dmMs. rulingTick (index.js step, BEFORE tableHold) fills overdue ones (`why slow`); nobody listening = scripted at once (`why gone`). setDmSeat(false) calls rulingGone. Integrate with #586 dmreflex.js (heard/dmAlive/gone) once merged.
- **Scenes:** table.js `setAttemptHooks({label,start,hold,apply})`: optionsFor appends `attempt` for a.player members (not decision); sceneAct stores act.rid; runTurns/runAll hold while the DM weighs it (instant/!sc.pause fills); apply() resolves at the member's turn (roll then). Ruling decided != resolved: r.state wait -> ruled -> done.
- **Runner:** dm-agent.mjs `rulingVoice` (like talkVoice), schema effects as objects with kind enum, `effectList` -> strings; flags --ruling-model/DM_RULING_MODEL (default table model Haiku 5.5), --ruling-budget (8/25), --no-ruling-voice. Cost estimate ~600 in / ~80 out tokens per ruling with Haiku 5.5 (~$0.0001); no live measurement yet.
- **Pitfalls:** check() uses the shared RNG (gen captured at import: override Math.random before import to force d20s); fake Date.now for waits; JSON.stringify of hero chat is circular (use a WeakSet replacer); localcheck matched the exact option list "steady, press" (now allows ", attempt"); bash heredocs with backslashes/quotes broke - write python edit scripts to the scratchpad with Write.

Related: [[staged-scenes]], [[npc-conversations]], [[give-item]], [[in-game-channels]].
