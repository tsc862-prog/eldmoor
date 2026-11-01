---
name: dm-agent
description: DM as an agent (#66 part 1) - DM seat, dm tools/MCP role routing, claim key 'dm', runner cadence and 429 backoff, supervisor kind, measured cost per turn, test approach and pitfalls
metadata:
  type: project
---

Built 2026-11-01 on branch ai/dm-agent-1 (PR "Part of #66"). Part 2 (fast at-the-table calls) not built.

- Seat: S.dmAgent {world tag 'w<gameMin>-<uid>', seat, notes{threads,characters,plans,secrets}, day caps, calls, seen}; created lazily (seeded sim identical to main; a silent open seat leaves a seeded world identical - dmcheck asserts). Browser: DM panel "Open seat" -> bridge connects while playerHero() || dmSeatOn(); hello carries dm:{seat}; relay -> page {type:'dmcall'}; links msg carries dm:{seat,link,claimed,runner}. Headless: play-headless --dm (--agents 0 allowed).
- Relay (relay-mcp.mjs): role from X-Eldmoor-Role header / ?role=dm / body role; /mcp?role=dm -> buildDmMcp (object args = z.record); POST /play/dm; claims under DM_KEY 'dm' in the same claims/act maps (linkOf('dm') works); claim refused 404 when seat closed, 409 when held. attachPlay returns dmCall, dmInfo.
- Levers: BY gained 'dm-agent'. Agent extras: 8 pulls/game day, named_foe refused, pileOn() refuses mark_dangerous/custom_foe/named_foe/bandits|migration near (14 tiles or same region) a Fellowship member <35% HP outside town.
- Runner scripts/dm-agent.mjs: claim {role:'dm'}; cadence evening (next 18:00 game time) or seconds; waits while S.table or open proposals; Agent SDK query with mcp url /mcp?role=dm + header; 429 detection via system api_retry (error_status 429 / error rate_limit|overloaded) and assistant m.error; backoff 30..600 s, retries a turn only if it made no tool calls. onSupervisorStop + abortController. Ollama path: localTurn({tools: DM_TOOLS, rules, opts.endOnWait:false}). Session logs/agents/dm.json via loadDmSession(world) in agent-sessions.mjs.
- Supervisor (scripts/runners.mjs, PR #119): kind dm got seat:'dm' (state from play.claimed/linkOf('dm'), mind from runnerOf('dm')), start refused 409 when seat closed or claimed; defaults 12 turns. Page: dmRunnerControl/dmRunnerSig in src/ui/runners.js; src/ui/dmseat.js renders #dmseat and the Minds DM row.
- Measured live (Sonnet 5.5 medium, headless day 4, no Fellowship): turn 1 15 tool calls 17.7 s $0.056 (59.7k in, 46k cached, 2.4k out); quiet turn 2 3 calls 7.5 s $0.013. It wrote notes in all four sections, pulled mark_place + create_npc, recovered from a "not a road tile" refusal; once hallucinated a tool name (harmless error).
- Pitfalls: init() does not reset S (new world = page reload), so don't test "new world" by calling init twice. Bash heredocs with python strings containing '\\n' mangled (use Write for edit scripts). runnercheck fake backend needed dm seat + fake child exit after stop (stop waits STOP_GRACE_MS for the child).
