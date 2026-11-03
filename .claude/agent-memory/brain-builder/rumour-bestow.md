---
name: rumour-bestow
description: #637/#638 seed_rumour + bestow levers (rumours.js, epithet.js): install-from-index pattern (import cycle TDZ), telling paths, refusal-aloud, check pitfalls, backspace-byte bug
metadata:
  type: project
---

PR #667. `seed_rumour` and `bestow` are levers defined in `src/sim/rumours.js` / `src/sim/epithet.js`, registered by `installRumourLever()`/`installBestowLever()` called in `sim/index.js` body (and idempotently in dmagent `renownTool`). DM tools dispatch via `renownTool` -> `pullLever(via)` (same caps/reserve/log as flat tools).

**Why the install pattern:** every sim module transitively imports levers.js (rumours -> lore -> weather -> levers), so `register()` at module eval hits a TDZ on levers' consts. Any new lever outside levers.js must register after the graph loads.

Telling: talk.js `passOn(c,p,a,said)` after scripted() and dmAnswer() (DM line that `carries()` the rumour = told silently); convView adds `word_to_pass_on`; player.js non-company talk appends `passOnTo`; list_jobs `word_at_the_gate` via `gateWord`. Once a day per hero (`r.heard[id]=dayNo`). Lapse is lazy in `liveRumours()`. Lore: `heardOf(a,about,from)` in lore.js; place entries use `from` (not `src`, which mk marks use).

Epithet: `styled(a)` used by UI renderers; refusal via `spokenAbout(a,text)` in talk.js noteSaid and ruling.js attempt.

**Pitfalls:** Python heredocs in Git Bash turned `\\b` into a raw 0x08 byte — write regex edits with the Write/Edit tool or bytes([92,98]). Pre-existing 0x08 regexes were found in dm-agent.mjs, relay.mjs, channelcheck, dmcheck (fixed in #667). talk scripted answers only happen when `DR.gone()` resets DM-heard times after a dmAct (else the conversation waits TURN_MS). Reserve tests: the lever `check()` (town cap) runs before pull()'s reserve check.

Related: [[dm-flat-tools]], [[talk-fallback]], [[dm-places-lore]].
