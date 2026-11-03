---
name: local-dm-narration
description: #467/#468 local-model fixes: nearform.js place shapes, localTurn circuit breaker + minute cap, narration echo/junk-call/CJK cleanup; test pitfalls
metadata:
  type: project
---

Issues #467 (local DM 68% refused, 125 calls/min flood) and #468 (qwen2.5:14b narration: prompt echo 6% of turns, junk-prefixed calls that never ran, Chinese tails), from the 2026-11-03 playtest review.

- **Place shapes:** `src/sim/nearform.js` `nearText(v)` -> `{s}` / `{err}`: `{x,y}` objects (raw or stringified), `[x,y]`, `(x,y)` -> "x,y"; "Town,dx,dy" / "Town (dx,dy)" -> base point (town gate, hero, DM place, landmark, region centre via `basePoint`) plus offset. Offset first (|d|<=30, on map); else the numbers as map coords within 20 of the base; else a modest offset past the edge is clamped onto the map ("kept on the map"); else refused with the map size. Used at the top of `placeOf`/`nearSpot` (dmagent.js), `whereOf` (staged.js) and lever point params (`asPt` in `leverParams`). Off-map "x,y" refusals add `pointHint` ("<town>,dx,dy").
- **Breaker (localTurn, all local/OpenAI turns):** `LOCAL_DEFAULTS.sameRefusals 3`, `consecutiveRefusals 5` (page-away errors do not count) -> `stat.broke {tool,n,inRow,error}`, turn ends, `BREAK_NOTE` + last refusal pushed as a user line for the next turn. `callsPerMin 60` (DM passes 30, `--calls-per-min` / `DM_CALLS_PER_MIN`): a per-sess WeakMap window across turns -> `stat.throttled`. Flags `breaker`/`throttled` on turn lines (behavior-turn.mjs `localRec`), turn line "ended early: ...". Relay flood line is `BD.FLOOD_PER_MIN` 90.
- **Narration:** `cleanNarration` now runs `stripEcho` (cuts "End your turn now: one short sentence of narration ..." anywhere, also clipped "nd your turn with ..."; at an "End of turn:" label keeps the words after it if 8+ letters, else before), drops `</?tool_call>` and a `Junk="..."` wrapper, and `cutForeign` removes non-Latin runs when 12+ Latin letters remain (a wholly foreign reply stays whole so the caller still flags `foreign` / re-prompts). `parseTextCalls` reads bare `{"name","arguments"}` objects in prose (must carry arguments/parameters/args), swallowing a junk word at line start and a trailing `</tool_call>`.

Pitfalls: dmcheck place-shape cases must reset `S.levers.day.rz` (per-region daily counts) besides `n`/`nf`/`cd`, and remove the test NPC from both `S.wanderers` and `S.levers.active` or the later stage_scene meeting hits "6 create_npc already active". Python heredoc edits of regex-heavy JS mangle escapes: use the Edit tool or a node script. Seeded hash unchanged (1733832012 via professioncheck --hash on both trees).

Not done: "local DM gets only the flat tools" (issue #467's third expectation) — the tool list is unchanged.
