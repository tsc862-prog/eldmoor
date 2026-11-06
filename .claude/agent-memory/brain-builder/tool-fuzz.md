---
name: tool-fuzz
description: scripts/toolfuzz.mjs (npm run toolfuzz) - every hero and DM tool with valid, empty and hostile args in 16 states per world; what it found; src/sim/argfix.js door; pitfalls
metadata:
  type: project
---

`npm run toolfuzz` (about 35 s, both worlds as parallel children, in the CI `world` job). One child per world (`--world id`, because the world is
chosen once per process). 16 states: fresh (built directly, never restored), fresh-noseat, fresh-saved, fresh-none, prep (held by the DM's prep),
town, rich (lvl 12, gold, pack, trades), town-none, field, field-none, path, scene, crawl, downed, dead, solo. Every state but the direct ones is
restored from a JSON save before each tool, so each also proves the round trip. Flags: `--seed N` (TOOLFUZZ_SEED), `--state a,b`, `--tool a,b`,
`--only hero|dm`, `--sets N` (arg sets a tool, default 9), `--show` (print every call), `--list`. A failure prints the replay command.

Fail kinds: threw (playerAct "The world did not understand that (...)" / dmAct "The DM tool failed", or a JS exception text anywhere in a result or
in a new DM log line: levers swallow their own throws as "failed: ..."), nonobject, bad-number (result, hero, clock, mobs), bad-text
(undefined / NaN / Infinity / [object Object] in text), no-way-on (refusal under 3 words), unlisted, step-threw, save-drift (first successful act
tool of each kind: snapshot -> JSON -> restore -> snapshot must match; a hero ref's name/fac are ignored, the closed-seat state is exempt because
a load opens the seat with a DM log notice).

Valid arguments: harvested from the read-only tools' answers in that state (pools by key name, ALIAS table) plus RECIPES for the DM's writing tools.
Coverage line at the end lists tools that never went through (about 100 of 172 do; the rest need a situation: a fight, a listing, an offer).

What it found (all fixed in the same PR): `constructor` / `__proto__` read as table keys (craft recipes, become fields, read_dm_log kind, move_to spots,
lever alias; LEVERS is now a null-prototype object); start_event on day one threw in post_hook (S.adventures not made yet, the #910 cause, also fixed
there); flee_below "abc" gave NaN; auction_list index 0.5; objects where strings belong printed "[object Object]" in chat, notes and refusals;
DM turn record showed a lever effect as [object Object]; ~20 refusals printed "undefined" or "NaN".

`src/sim/argfix.js`: `cleanArgs(tool,args)` (called first in playerAct and dmAct) drops what the table rules out (object for string/number, non-finite
or "1e999" numbers, null; truncates fractions for integer; keeps strings for array/object args because tags "a, b" and JSON text are read) and
`polishRefusal` rewrites a refusal with undefined/NaN/[object Object] or under 3 words into "Missing argument: x (desc)". It never rewrites a JS
exception text (JS_ERR), or the fuzz could not see throws.

Pitfalls: a heredoc template literal turns `\b` into backspace (use String.raw or the Edit tool; `\\s` in a quoted heredoc lost its backslashes);
`python3` here hangs; the dm test for a throw must read the DM log, not only the result; Math.random is not what `rnd` uses (seedRng is).
