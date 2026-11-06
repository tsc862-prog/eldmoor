---
name: long-company-run
description: #926 long headless run with mock minds (scripts/longrun.mjs): harness, what it found (scene dedupe key, wake spam, --warm dead), what it can and cannot prove
metadata:
  type: project
---

`scripts/longrun.mjs` (+ `longrun-report.mjs`): headless world (`--fellowship --solos N --told-crypt --fellowship-level L`) + the real runners against mock Ollama model `mock-crypt:1b` (mock-table plus: the leader proposes crypt from L8 / raid from L14, a solo does read_chronicle then go_crypt / join_raid, picks heal/stabilize before strike). Ports 8795-8799, `--port`. A solo's heir gets an agent-player runner from the harness (no supervisor). Samples world RSS every 30 s.

Found and fixed: (1) `play-headless --warm` was dead since #780 (the `const warm` sat inside a `//` comment). (2) `sceneKey` in `local-agent.mjs` (dedupe of "answered a moment ago", 10 real min) ignored scene id and round: the same proposal text asked twice, or round 2 of a rescue, was never answered by the runner and the table waited out liveMs; fixed with `id` and `round` in `brief.scene` (pace.js sceneOpen). (3) `paceCheck` woke a hero for any open scene it had not acted in, even when it was not its turn: scene-jump turns were 422 of 471 scene turns with 160 answers; now only when `tv.your_turn` (YOUR TURN event, level 3, wakes the rest). After: 241 jumps / 231 forced answers.

Not proved: whether real models choose to propose crypt/raid (mock does by rule). Raid never mustered in ~7 game days (members apart when the muster vote passed: "never came together"); join_raid always refused "nobody raiding". Fellowship at L8 reaches L10 in ~6 game days (~35 real min at 8x); 150 min needed for L14.
Why: owner asked whether companies start crypt/raid without world-opened votes (#826). How to apply: rerun longrun for any change to council/table/pace; look at scene-jump vs forced-scene ratio and `scene-missed` in the report.
