---
name: behavior-logs
description: #129 behavior logs (logs/behavior/<world>/) - turn-line protocol, seat check, world digest via bridge, detector thresholds, report, behaviorcheck design and pitfalls
metadata:
  type: project
---

Built 2026-11-01/02 on branch infra/behavior-logs, PR #143 ("Closes #129"). These logs are for the watcher and the playtest-reviewer agent only; nothing ever feeds them back to an agent.

- **Turn-line protocol:**
  - Runners call `reportTurn(base, {hero|role:'dm', runner, provider, model, turn, wake, brief, tools:[{name,ok,error?,refused?}], narration, seconds, tokensIn, tokensOut, cost, flags, error?})`, defined in scripts/behavior-turn.mjs.
  - It sends `POST /play/behavior/turn {hero|role, runner, rec}` and never throws. It gets a 404 when the host has no logger.
  - relay-mcp accepts the line only from the runner whose claim holds that seat (409 otherwise). For a hero it adds `after` from be.call(id,'pace',{brief:true}), with a 3 s cap.
  - Claude turns now fetch pacer.brief() only for logging; the prompt does not carry it.
  - localTurn has `stat.calls`. turnCollector() parses SDK tool_use/tool_result blocks, matched by tool_use_id.
- **World name:**
  - The page hello sends `world: WORLD_ID` and browserBackend calls onWorld.
  - Headless worlds use `<WORLD_ID>-headless` (`--log-world`).
  - Relay /decide lines go to whichever world the page last named, else ELDMOOR_WORLD, else eldmoor.
- **Game watch (src/sim/behavior.js makeWatch().tick()):**
  - Read-only and outside step(). The bridge samples it every 500 ms and keeps up to 200 records while the socket is down; play-headless samples it every 250 ms.
  - Pitfall: at 1x a Table scene pauses S.gameMin. tick() must still read scenes, votes and levers when dt == 0; the first version returned early and missed reflex scenes.
- **Detector thresholds:**
  - BD, relay side:
    - EMPTY_RUN 3; REPEAT_SIM .8 against the last 4 narrations; REFUSED_RUN 3;
    - RELAY_FAILS 5 in 5 min; FLOOD 90 tool calls per seat per minute; DECIDE 240 per minute;
    - Ollama models seen within 30 min;
    - QUIET: one line per (kind, seat) per 5 real min, the rest counted as heldBack.
  - BW, game side:
    - IDLE 120 game min within 2 tiles, again every 240; STUCK 360 game min with no state, kill or level change;
    - SCENE_RUN 2; VOTE_RUN 2;
    - REFUSE 3 in 120 game min, and at least half of the pulls;
    - HURT .35; NEAR 14 or the same region; DANGER levers: mark_dangerous, named_foe, custom_foe, set_condition.
- **Stale claim:** fight words in the narration, no foe or fight state in either the before or the after brief, and no fight, hunt, scene_act or flee call.
- **Scrub:** sk-..., AIza..., Bearer tokens and *KEY= values become [redacted]; header and key-named fields are dropped.
- **behaviorcheck (~15 s):**
  - It covers all 14 anomaly kinds, the seat check, redaction, rotation and the real-runner section (play-headless plus agent-player with mock-lazy:1b: turns 1-3 act, 4-5 empty and stale, 6 fresh).
  - Pitfall: repeated init() in one process is NOT deterministic (module state). Prove "the watch reads only" with two fresh child processes instead.
  - Pitfall: a merged main changes the seeded world, so the lever spot must be searched with LV.spotErr.
- **Verification:**
  - The seeded `sim -- 60` was identical to origin/main. The scratchpad seeded.mjs wrapper plus `git archive` + `tar --force-local` works.
  - The page path was tested with a ws client against a spare relay (RELAY_PORT=8797, --play-only). No browser run, because the owner's 8787/5173 must not be touched.
- **Not built (possible follow-ups):** runner crash anomalies from the supervisor, and DM narrate counts beyond chat counts. Decisions for AI heroes outside a Fellowship are logged game-side only while the bridge is connected.

Related: [[runner-pacing]], [[in-game-channels]], [[dm-agent]].
