---
name: companion-voice
description: #764 compvoice.js - scripted companions of agent companies voiced by the DM; call protocol, memory, fill rule, caps, hooks, test pitfalls
metadata:
  type: project
---
#764 (2026-11-03): a scripted hero in a company with a living agent (hire, invite companion) speaks through the DM, not the camp table.

- voiced(a) = !a.player and companyOf(a) has a living player. Background companies never reach compvoice, so hashes hold (hashcheck equal).
- Hooks: camp.js talk() (compLine before the relay-brain path; quarrel reply too), talk.js noteSaid -> setSaidHook (say/party_say replies; aim shouts skipped via e.aim), player.js talk tool toward a companion, index.js compTick after talkTick.
- Protocol: companion_call {budget_s, wait_ms} (long-poll in player-host DM_POLLS, relay VOICE_POLLS, prep IDLE) -> call {call, seconds_left, trigger camp|reply|talk|quarrel, topic, companion card, where, listeners[{you_said_to_them}], their_words, today (company log today), heard (heardLines 8)}; answer companion_say {call, text} (<=300, English, spokeFor cut, sameness>=.8 vs said-to-listener refused).
- companion_call is intercepted at the top of dmAct (own listening stamp in compvoice, never dmHeard: stamping 'act' would make NPC talk wait TURN_MS 40 s).
- Waits only while companion_call polled within POLL_MS 10 s (or dmAlive + recent act: GRACE 12 s); else fill at once. Fill: row unused by every agent listener (a.cvoice[lid].rows), starts over per listener when all used; CAMP_NEEDS tags (fight/camp) filter.
- Caps: COMP.PER_DAY 6 per companion (replies count, fills count), DM_PER_DAY 36; past it silent. dm_status.companions once S.compVoice exists.
- Runner: companionVoice in dm-agent.mjs, talk model, --no-companion-voice, --companion-budget. spokefor.js copied byte-identical from PR #753 (merges cleanly as add/add).
- Pitfalls: hires' days run out when a test jumps days (extend hire.until); chat buffers cap at 20 so compare entry identity, not length; dmLog is capped, filter by gameMin.
- Latency/cost per line: not measured live yet (one Haiku call, ~maxTokens 300).
