---
name: dm-when-watch
description: "#635 DM when (deferred actions on a trigger) and watch (DM-chosen wakes): dmwhen.js shape, hooks into dmagent run(), runner eventDue/whenNote, test child, pitfalls"
metadata:
  type: project
---

`src/sim/dmwhen.js` holds the trigger table (`TRIGGERS`, append-only, mirrored by `TRIGGER_NAMES` in `src/data/dm-tools.js`; a load-time throw if they differ), edge state per entry, `whenTick()` (called first in `dmagent.js` `dreamTick`, every `WHEN.EVERY` 2 game min, returns at once when `S.dmAgent.when` is absent or empty, so seeded hashes do not move).

- dmwhen does not import dmagent: dmagent registers `setWhenHooks({fire: run, check: whenCheck})`. `dmAct`'s switch was split into `run(tool,args)` so a firing goes through the same tool code without the seat check or the turn record. DM log lines written during a firing get `detail.when` stamped after (scan S.dmLog newest-first by id).
- Set-time checks: generic required/enum args from the DM_TOOLS row; `whenCheck` adds lever params (`validate` exported from levers.js), narrate near, npc, hero; stage_scene gets a preview attached, never refused for transient conditions. `{who}` (or `$who`) skips hero/place reads and is refused on triggers without a hero.
- dm_status gets `whens, watches, fired (seq), watches_fired (id)` only once something was set. Runner: `eventDue` also fires on `newWatches(st, last.watch)`; `sess.lastWatch`/`sess.lastFired` = max seen at turn start; `whenNote` appended to the turn prompt; `DM_WHEN_ORDERS` + `withDmWhenOrders`.
- Test: `scripts/dmwhen-test.mjs` (69 checks, a child of dmcheck section 0; not named *check so rulescheck does not demand a ci.yml step). It drives `whenTick()` with `S.gameMin += n` instead of stepping.

**Why:** owner's second tools pass: the DM acts between turns and chooses what wakes it.

**Pitfalls:** recent lists keep 24 game hours, so a test counting hits across a day must read the entry's own `fired` count. Bash heredoc + python/node rewrites turned `\b` into a backspace and `'\n'` into a real newline in CRLF files: write fix scripts with Write, not heredocs. Found and fixed a pre-existing backspace in `withDmSightOrders`' regex (it never matched, so the sight orders were appended on every resume).
