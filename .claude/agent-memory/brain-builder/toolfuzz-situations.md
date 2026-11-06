---
name: toolfuzz-situations
description: toolfuzz situational states (scripts/toolfuzz-cases.mjs), recipe protocol, harness pitfalls, coverage numbers, bugs found
metadata:
  type: project
---

Situations for `scripts/toolfuzz.mjs` live in `scripts/toolfuzz-cases.mjs` (`makeCases(env)` -> `{states, hero(c), dm(c)}`).
- A state is `{name, make, only?, also?}`; the fuzzer marks them `lite`: acting tools only (`only` names the tools instead, `also` adds read tools such as scene_act), 6 sets a tool, recipes first.
- A recipe is an args object or `{pre: [[tool, args] | ['dm:tool', args] | ['step', seconds]], args: obj | (preResults) => obj}`; recipes are read from live state at the call, run before the generic sets, and the state is restored after each one that went through (a success uses the situation up).
- Coverage 168-170 of 172 per world (was 103). Known never: `choose` (a pick exists only mid-adventure), `dm:nudge_relation` (registered stub, "not available yet"), `dm:npc_offer` follow-ups (need a conversation a member started); `companion_say` and `send_courier` depend on the seed. Gate: --max-never 8.
- Time: about 65 s eldmoor, 80 s stepping, run side by side (1m25s). Restores (JSON.parse + restore per tool) are the cost; keep new states on `only` lists.

Harness pitfalls found on the way (all in the original fuzzer):
- `goDown(x, null)` returns false (needs a killer): the old `downed` state never downed anyone. `fell()` now throws if the hero is not downed.
- `data/materials.js` does not exist (MATERIALS is in data/items.js); the old import failed silently and `rich` carried no materials.
- `MAP.ZONES` is a list of names, not objects: REGIONS was always empty.
- Hand-placed positions are invisible to `look`/sight until `spatial.rebuild()`; a restore needs it too (the first tick does it in play).
- `playRate` (12 acts a game hour) refused every call after the 12th: reset before each call.
- A DM log summary can hold a live hero (circular JSON): use `safe()`.
- One `secs(1)` is 6 game minutes: a downed companion is revived by the Fellowship healer; use `run(n)` frames.
- place_person has a cooldown of one per region per hour; the DM pulls cap at 8 a day.
- Votes and scene frames: `RL.setRunnerLinks(()=>'connected')` and `DR.setDmAlive(()=>true)` make a decision wait for the agent/DM; `build()` clears both.

Real bug found: `market.js` buyListing did `t[l.kind]++` with kind 'good' but the stat is `goods`: tradeStats.good became NaN (save-drift finding). Fixed.
