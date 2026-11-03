---
name: dm-always-setup
description: #559 (slice A of #520) DM mind required on setup, seat open from tick 1, gate always counts DM, --wait-ready/--no-dm, resume starts DM; world-held refusal of hero act tools during gate/prep
metadata:
  type: project
---

Built 2026-11-02 on branch brain/dm-always-setup (PR "Closes #559", part of #520). Slices B #560 (panel, alert), C #561 (reflex paths), D #562 (old saves + CLAUDE.md hard rule) follow; the hard rule text was left to D.

**Setup (src/sim/setup.js):** DM_MODES=['agent']; DEFAULT_DM()=Claude Haiku (default setup and 'haiku' preset); 'claude' preset keeps Sonnet. validateSetup refuses a scripted DM ("the DM is always an agent; pick its model") or a missing dm. cleanSetup turns an old scripted DM into DEFAULT_DM. applyMinds and opening.js (apart) always setDmSeat(true). planRunners always appends a dm runner.
**Page:** setup page DM section is a "DM agent" tag + model select (no Scripted button). rungate.ensureDmSeat() opens the seat once per S.worldId (skipped with a test probe); seats() counts the DM whenever the seat is open; Close seat still works until #560.
**Headless:** play-headless --wait-ready opens the DM seat unless --no-dm (localcheck's hero-only gate test uses --no-dm).
**Resume:** runners.mjs resume() starts a DM runner (kind dm, no provider = saved/default mind) when dmInfo().seat is open, unclaimed and none was saved. upcheck covers it.

**World held (owner bug folded into #559):** members introduced themselves during the DM prep. sim/prep.js: setGateHold(v) from the host (rungate: list.length>0; play-headless: notReady non-empty), worldHeld() -> 'prep'|'gate'|null, holdLine(). pace.js paceCheck returns null while held. player.js playerAct refuses meta.act tools with {ok:false, held, offline:true, error:holdLine()}; offline:true makes local-agent count it as gameDown (not a failed turn). Reads (act:false) answer. tablecheck --arrival asserts it.
Pitfall: uismoke boots initUI, which now opens the DM seat and holds the gate -> every agent act tool refused. uismoke closes the seat right after initUI.

**Hash recipe without a junction:** git archive origin/main | tar -x into scratchpad; dmcheck can't run there (needs ws). Use a standalone script outside both trees that seeds Math.random like dmcheck (0x9e3779b9^66 LCG) and imports <root>/src/sim/index.js. none/seat hashes equal main; a default-setup world with the seat open and no runner hashes the same as main's scripted-DM setup.

**Continuous gate (owner decision on #559, 2026-11-03: "if not every mind is active (character or DM) the world should be paused").**
- rungate: ACTIVE={ready, failed}: a failed warm-up with a live runner counts. seatRunner(s) falls back to the last DONE runner covering the seat (hero key, heroes list, or a fellowship kind for a fellow) so a crashed Fellowship runner pauses at once (runnerFor returns only live runners or the own hero runner). Override button reads "Resume anyway" once the world ran (`ran`); waivers keep their #222 meaning (until the next change).
- Relay turnPlayed upgrades a failed warm-up to ready (implied, warmFailed) when its runner plays a turn.
- play-headless --wait-ready: active(id) = claimed and ready|failed; notReady runs every tick, so a released claim holds at once.
- The supervisor drops a finished child's claims (dropRunner), so a supervised stop/crash/budget is instant; a terminal runner that crashes still waits for its claim (45 s CLAIM_MS) plus the 30 s grace.
- labelcheck section 6 covers crash -> paused/named, restart -> runs, DM stop -> paused, Resume anyway until the next change. Pitfall: in labelcheck a claim posted with a finished runner's id is accepted and keeps that seat live.
- Deadlock to avoid: the hold gives no paced turns, so never make readiness depend on a played turn alone (failed+live must count directly).
