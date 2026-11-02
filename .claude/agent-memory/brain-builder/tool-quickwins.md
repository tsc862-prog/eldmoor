---
name: tool-quickwins
description: #399 tool quick wins A - owner rule "never narrow tools, accept more and fail helpfully"; move_to label parsing, header town place, name targets, PAUSED relay error, toolwincheck pitfalls
metadata:
  type: project
---

Owner direction (2026-11-02, tools audit): agents should have as many tools as possible; never remove or narrow a
tool, make it accept more and fail with the legal choices listed.

**Why:** local qwen heroes failed 26% of calls, mostly move_to "Unknown place" (239) on the game's own labels,
"hunt in town" (header said the region), guessed target ids, and human-advice relay errors ("Press Agent").

**How to apply:**
- move_to/lead_to: `plan()` tries `placeVariants` (paren stripped, the/town stripped, spot words, `<spot> in|of <town>`,
  `<town> <spot>`) through `planOne` (null = no match, {error} = a specific refusal), then `placeFallback` (known region
  inside the words, world name -> home region, companion in sight), then `unknownPlace` (did-you-mean + placesView).
  Only names from `knownNames(a)` (lore places + friendly towns) are ever offered back (#188).
- Header `place`: "Highgate (town; Thornvale around it)" in a town (pace.js placeOf); move_to reads it back.
- Targets: `friendBy`/`foeBy` take id or name (in sight only); refusals carry `friendList`/`foeList` with ids. New
  optional string args: `target` (fight, use_ability, use_item), `to` (give), `who` (join_party); fight's target_id and
  give/join_party's hero_id became optional. local-agent `cleanArgs` moves a name given in an `*_id` integer arg to
  that name arg.
- Relay: `PAUSED` in relay-mcp.mjs, every page-away result is `{ok:false, error:PAUSED, offline:true, why}`; the
  "Hero #N is not agent-played" line is kept (pacing reads /not agent-played/ as gone).
- Checks: `npm run toolwincheck` (in CI). Pitfall: playerAct's rate limit (PK.RATE 12 acts a game hour) trips a check
  that calls many act tools; reset `a.playRate = []` per call. The headless sim is unseeded, so prove "world unchanged"
  with `node scripts/professioncheck.mjs --hash` against a `git archive origin/main` copy in the scratchpad (sim is
  dependency-free, runs without node_modules).
- Related: [[agent-player]], [[earshot]]; audit follow-ups not done here: camp refusals, scene_act staleness, DM lever
  contracts, local tool subsets, Claude turn header.
