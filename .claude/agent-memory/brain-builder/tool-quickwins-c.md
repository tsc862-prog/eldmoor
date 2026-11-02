---
name: tool-quickwins-c
description: #401 tool quick wins C: DM errors carry the contract (leverUsage), lever-as-tool hint, fenced json calls, claudeBrief header + turn order for Claude turns; pitfalls
metadata:
  type: project
---

Issue #401 (from the 2026-11-02 tools audit; owner: "as many tools as possible, make calls succeed and fail helpfully, never remove tools").

- **DM errors carry the fix.** `leverUsage(name)` / `leverNames()` in `src/sim/levers.js` (read only) give one line of a lever's params (`k?` optional, `k=def`, enums, region/town lists). `pullLever` in `dmagent.js` appends it to shape errors (missing reason, bad/missing param) and returns `usage`; limit/cooldown/reserve refusals get no contract (they are rules to wait out). `leverParams` reshapes only: params as JSON string, lever keys at top level beside lever/reason, a point as `x,y` / `coords` / `"x,y"` / `[x,y]`. Refusal order and limits unchanged.
- **Lever name called as a tool:** `unknownTool` in `dmagent.js` (game side, `/play/dm`) and `cleanArgs` in `local-agent.mjs` (when the list has pull_lever) point to `pull_lever {"lever":..}`. Claude via MCP never reaches the game for an unknown tool (the SDK refuses it), so pull_lever's description names the lever names too.
- **stage_scene:** `reason` is required in the schema now (preview needs a few words); refusals of a wrong call add `STAGE_USAGE`; unknown place lists members, landmarks, DM places, regions; landmarks resolve in `whereOf` ("Sunken Crypt" with or without "The").
- **npc_say/npc_offer:** `personFor` takes npc, else conv's person; names match ignoring spaces/punctuation; `nobody()` suggests 3 closest (edit distance) with ids and `did_you_mean`.
- **Fenced json:** `parseTextCalls` reads ```json blocks inside prose ({name,arguments}, {tool,args}, {function:{...}}, or a list); a fence that is not a call stays narration. `cleanArgs` folds unknown keys into a tool's single object arg (pull_lever params; stage_scene cast).
- **Claude turns:** `claudeBrief(b)` in `pacing.mjs` = briefText minus its "Act through the tools" line + "This turn: ... Act, then wait; when wait returns act on events or end the turn". Used by agent-player and fellowship (outside scenes; scene prompts unchanged). Earshot (#398) rides inside via talkText -> earshotNote.

Pitfalls: dmcheck counts staged-scene refusals in the DM log exactly (`n0 + 22` after #401); the `--focus` sub-run of dmcheck can fail with an empty line under heavy parallel load (rerun). `npm run sim` is unseeded, so prove "unchanged" with `node scripts/professioncheck.mjs --hash` on both trees (git archive origin/main into the scratchpad).

Expected effect to measure later: local DM pull_lever/stage_scene/npc_say failure counts (audit: 49/48/19) and Claude cap hits (44% of turns) on the next behavior-report.
