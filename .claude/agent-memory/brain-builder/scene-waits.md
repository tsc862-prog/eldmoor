---
name: scene-waits
description: #515 scene-first scheduling - table_waits note, urgent Ollama queue + withdraw, local free-turn interrupt/joinTurns, Claude scene-first, pace {queued} extra wait (SW.EXTRA_MS), scene-missed anomaly, waited_s/sceneS latency, scenewaitcheck
metadata:
  type: project
---

Built 2026-11-02 on branch brain/scene-first (PR "Closes #515"). Owner: Fellowship agents sometimes miss Table windows.

**Confirmed causes (from logs/behavior/eldmoor/turns.jsonl):** a turn in flight when the scene opened ran its whole tool loop (55-98 s) without knowing; one Fellowship runner serialises local members on one Ollama queue (OLLAMA_PARALLEL 1), so a scene answer waited behind others' turns past TABLE.liveMs (120 s); Haiku scene turns hit error_max_turns before scene_act.

- Game (src/sim/scenewait.js, mine): `sceneDue(a)`, `waitsNote` -> every playerAct result (not scene_act) and finishWait carry `table_waits` while the hero's own scene is unanswered; `scene_act` returns `waited_s` (table seconds: sc.w[id].t in 'all' scenes, sc.t on your turn; 0 during the DM frame). `markQueued` via `/play/pace {queued:true}` (relay-mcp passes it, player-host answers) pushes the id on `sc.q`; `liveLimit(sc,a,TABLE.liveMs)` adds `SW.EXTRA_MS` 90000. `missed()` -> `sc.miss`. table.js (ai-designer) edits: one import + the two liveMs comparisons + missed() calls; hashes unchanged.
- Health: `heroes[].due` (bridge hello, play-headless info, relay sanitiser).
- Ollama adapter chat({urgent, signal}): urgent goes ahead of ordinary waiters (FIFO among urgent); an aborted signal while queued rejects `{withdrawn}` without posting; `busy()`. chatAsk always urgent.
- localTurn({interrupt}): a 200 ms poll aborts the in-flight/queued call -> `stat.sceneJump`; a result with `table_waits` sets it too (stopNow). Jumped turns with 0 tools are not empty. `joinTurns(a,b)` merges the forced answer. Flags 'scene-jump'; localRec passes `sceneS`.
- fellowship.mjs: watcher sets m.due; reports queued once per scene when m.inTurn, ollama.busy()>0, or the Claude cap is full; local free turns pass interrupt (not scene turns); Claude: scene open at turn start -> claudeScene (structured Haiku/own-model answer) first, skip the query; after every Claude turn the brief is checked. agent-player: afterJump + same Claude scene-first.
- Behavior: game anomaly `scene-missed` (bad, evidence queued/mind), digest table.missed/queued; turn line `sceneS`; report section "Table scene answers" (`sceneAnswers(T,A)` exported).
- Check `npm run scenewaitcheck` (CI): mock-busy:1b (1.2 s per loop call, 150 ms scene answer). Measured: five members mid-turn on one queue, 'all' scene resolved in 3.5 s (window set to 15 s), mid-turn member jumped, all 5 reported queued.
- Pitfalls: the scene spends TABLE.frameS (1.6 s) in 'frame' before waits tick; makeWatch must tick while the scene is open to see it resolve; `npm run sim` is unseeded, compare `professioncheck --hash` / `tablecheck --hash` against a `git archive main` copy in scratch.
