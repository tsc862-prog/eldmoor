---
name: in-game-channels
description: #123 owner rule (DM and players talk only inside the game) - leak audit results, runner-scoped relay protocol, DM narrate/npc_say, chat_read, channelcheck design and pitfalls
metadata:
  type: project
---

Owner rule (issue #123, built 2026-11-01 on branch ai/in-game-channels): the DM and the players (Fellowship members, agent heroes) communicate only inside the game. The watcher (owner's browser) may still see everything; the rule binds agents/seats.

**Why:** the owner wants agents to be characters, not a chat room of models; any new tool, prompt or route that carries one seat's text to another breaks it.
**How to apply:** any new hero tool/snapshot field must be "what the character perceives"; any new runner/relay route must name its seat; add a planted secret to scripts/channelcheck.mjs for any new private store.

- Real leaks found and fixed: persona/backstory relay snapshots carried companions' backstory.summary (their persona "wants"); look() flagged which heroes are agent-played; relay let any local process call any claimed hero (read another member's journal) and /play/dm had no role check; GET /play/runner exposed runners' output lines (DM thinking) to any local process.
- Already safe (verified): fellowship.mjs turn prompts are fixed text, sessions per hero, orchestration via /play/health (ids/names/roles/links only); readDm/table only use roll/scene kinds with fellow heroes, DM 'agent' entries have heroes []; lever reasons and notes never reach chronicle/history; relay.mjs stateless; scripts/agent-chat.mjs does not exist.
- Relay protocol now: runners send X-Eldmoor-Runner header or ?runner= on /mcp, `runner` in /play/* bodies. Claimed hero + other/no runner -> 409 {refused:true}. /play/dm: 403 if a hero is named or the runner holds a hero claim; 409 if the DM seat is held by another runner. /play/call|narrate with role dm -> 403. One runner id never holds a hero and the DM seat. DM runner id is `${host}:${pid}:dm` (supervisor dropRunner prefix still matches). GET /play/runner: lines/error only for the page origin (runnercheck req defaults origin PAGE for /play/runner paths).
- DM voice: narrate {text, near (hero/town/region/"x,y"/"table"), radius 4-20 default 10} 12/day; npc_say {npc id|name, text} 16/day, HEAR 7. Chat entries from {kind:'dm',name:'The Narrator'} (stub like NPC from). Table: S.table.narr -> tableView.narrator, bannerOf().narr. Hero tool chat_read; events "The narrator: ...".
- channelcheck: 21 secrets, ~80 hero-side texts; leak test is per viewer (a member's own status legitimately holds its own secrets: first run "failed" on that). Verified it catches the old persona leak. ~10 s, seeds 1-5 green.
- Seeded `npm run sim -- 60` identical to the pre-change commit (scratchpad seeded.mjs wrapper + git archive --force-local tar).
- Pitfall again: bash heredocs eat `\'` in python strings; use Edit for any JS line with escaped quotes.
