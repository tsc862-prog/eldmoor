---
name: runner-pacing
description: #126 runner pacing by game time/events (/play/pace), local runners until stopped, failure stop, lazy/foreign local models, autopilot (never "scripted"), one mind per agent hero, hearing wakes, Ollama queue/timeouts, six runner seats, Claude slot leases; measured turns per game hour
metadata:
  type: project
---

Built 2026-11-01 on branch infra/runner-pacing (PR "Closes #126"). The coordinator folded in several live bugs from the owner during the work.

**Owner rule (2026-11-01):** an agent-played hero is never scripted. While its agent is silent it runs on "autopilot" (the last order plus reflexes) or "reflex", never updAgent. It has no relay brain and voices no scripted line, and the UI shows it as AGENT with its link state.
**Why:** the owner saw agent Fellowship members shown as SCRIPTED and answered by scripted camp lines.
**How to apply:** any new behaviour, label or voice path must check a.player first.

- Protocol: POST /play/pace {hero, runner, since?, minutes?, wake:'now'|'must'|'all', realMs?} or {brief:true}.
  - Path: relay-mcp checks the claim, does not count it as link activity and does not log it, then calls backend.call(id,'pace'). player-host hostCall special-cases 'pace', which is never a tool (MCP and /play/call do not offer it). src/sim/pace.js answers.
  - The answer is {wake:'now'|'soft'|'heartbeat'|null, must?, why, since, clock, table}, or {ok:false, dead|gone}.
  - {brief:true} returns the state header: state, doing, HP, place, foe, autopilot, table, unread news.
  - Fallbacks: an old relay (404) or an old page ("Unknown tool pace") makes the runner fall back to real time, as if at 1x. "not agent-played" (localBackend answers it offline:true) means gone.
- Wake levels, notify.js ev(a,text,urgent,wake):
  - urgent=3 (e.w=3) is must-answer: a choice, TABLE, YOUR TURN.
  - urgent=2 is now: attacked, duel, assist, badly hurt, camp alarm, and a heard line from an agent hero (debounced PK.HEAR_WAKE 15 game min per listener).
  - Other urgent events and wake=1 (party line, narrator, NPC) are soft.
  - Pace reads e.n > a.playEvSeen and never consumes events.
- scripts/pacing.mjs:
  - makePacer defaults: heartbeat 240 game min, gap 20 s, max fails 5. Immediate 'now' turns are limited to NOW_MAX 2 per 60 s real; 'must' always goes through.
  - The real qwen run at 8x before this limit: 3.4 turns/real min, 12 of 17 wakes 'now', mostly attacks.
  - turnCap: ollama runs until stopped; otherwise 20 (hero), 6 (member), 12 (DM).
  - Helpers: failTracker; localWorked (not empty, not a repeat without an act, not foreign); briefText; preferLoaded / localModelNote via the adapter's loaded() (/api/ps); takeClaudeSlot / withClaudeSlot.
- local-agent.mjs:
  - Re-prompts once (REPROMPT, or REPROMPT_EN when the reply is foreign; src/sim/lang.js notEnglish is a Latin-letter share < .8).
  - Only the latest narration is kept in history (narr:1). similar() >= .8 counts as a repeat.
  - Sampling: temperature .6, repeat_penalty 1.15. After freshAfter 2 empty turns the next turn clears the history (L.emptyRun).
  - Turn flags: fresh / re-prompted / empty.
- Ollama adapter chat(): node:http postJson with its own timeout (OLLAMA_CHAT_TIMEOUT 600 s). undici's 5-minute headers timeout caused the owner's "fetch failed". There is one queue per adapter (OLLAMA_PARALLEL 1), clear busy/loading and not-reachable errors, and loaded(). Live evidence: the relay kept qwen2.5:14b on the GPU, so a 4b runner model never loaded in 280 s.
- player.js (shared with #124, kept small):
  - PK.IDLE 120 and PK.HEAR_WAKE 15. a.playActAt is set on a successful act and on markPlayer. a.playOrder holds the last hunt.
  - autopilot(a) gives a rest when hurt, or a repeat of the last hunt, in the field only. a.playIdle shows as "autopilot: ...".
  - say/party_say refuse non-English. agentLine (in chat.js) tags e.agent and e.model 'AGENT · <runner tag>' through setAgentTag from player-bridge.
- Elsewhere in sim:
  - chat.say returns at once for a.player. camp talk uses no agent as a speaker; with only agents present it sends one notify(…,false,1).
  - fellowship setMinds('agent') turns the brain off. panels.js does not show the AI-played badge when a.player is set.
- Supervisor:
  - maxTurns is null unless asked. The view adds turnCap, turnsPerMin, lastTurnAt/Ago and pace.
  - MAX_RUNNERS is 6 (RELAY_MAX_RUNNERS). SEATS 6: Fellowship members, the Fellowship runner and the DM always fit.
  - Claude slots are leased per turn: /play/runner/slot (waits 20 s, the child retries) and /slot/release. The child gets ELDMOOR_RUNNER_KEY. A start is never refused for slots.
  - UI: a turn-cap select, and a warning when the minds and a runner use different local models.
- Split out (proposed to the coordinator):
  - #3: a single mind label everywhere beyond the header badge.
  - #4: game day on times.
  - #5: per-action source marking in the Log. Only "Last agent order N min ago" and autopilot in the Agent tab are done.
  - Ollama-busy link state.
- Tests: localcheck section 4, parts A to E; runnercheck seats and leases. tablecheck "leader left" now uses the farthest point. The seeded sim -- 60 run is identical.
- Measured with default pacing on a headless world (PR #134):
  - mock at 1x: 0.25 turns/game h, 1.5 turns/real min;
  - mock at 8x: 0.062 turns/game h, 3.0 turns/real min;
  - qwen2.5:14b at 8x: 0.046 turns/game h, 2.2 turns/real min, 1 empty turn of 11, turns 5-17 s;
  - qwen2.5:14b at 1x (an active hero, woken mostly by arrivals): 0.36 turns/game h, 2.17 turns/real min, 0 empty of 13.
- Pitfall: python heredocs in bash eat backslashes. Use the Edit tool for JS lines with \n or regex escapes.
