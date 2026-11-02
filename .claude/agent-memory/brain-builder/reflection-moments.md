---
name: reflection-moments
description: #179 reflection turns - moment kinds and hooks, budget numbers, pace protocol {reflect}/{reflected}, structured notes schema, journal-into-memory decision, test pitfalls
metadata:
  type: project
---

Built 2026-11-01 on branch ai/reflection-moments (closes #179). Why: live, 130 local agent turns made 0 `remember` calls.

- **Moments** (`src/sim/reflect.js`, agent-played heroes only, so the seeded sim is unchanged; verified by a seeded hash compare vs main):
  - camp: `onCamp` 'make' in player.js
  - scene: end of a Table scene (table.js outcome)
  - death: fellowship.js onDeath
  - oath: goals.js complete
  - trade: buy or sell of >= REFLECT.TRADE (150g)
  - talk: `talked()` counts 4 lines within 180 game minutes (say, party_say, talk_to); #170 can call `moment(a,'talk',...)`
  - dusk: from 19:00, once a day, only if EV_MIN events or an order since the last one
- **Budget:** PER_DAY 4, GAP 90, TTL 360, OPEN 30 (notes written just after a reflection still count). Moments close together merge.
- **Protocol:**
  - `brief.reflect = {id, kind, why}` in the state header.
  - The runner long-polls `/play/pace {reflect:true}`, which gives a soft wake.
  - The runner closes the moment with `POST /play/pace {reflected:id, wrote:n}`.
  - A remember while a moment is due closes it and stamps the note with `rf`.
- **Answer format:**
  - Local and OpenAI: one forced answer `{notes:[{title,text,tags,about}]}` (strict mode requires about; maxItems is dropped and the cap applied in code).
  - `reflectTurn` in local-agent.mjs sends each note with remember.
  - Claude: `reflectPrompt` with tool use, maxTurns 4.
- **Journal decision:** every journal_write also becomes a memory tagged `journal`. Note ids shift because of it; channelcheck now finds `<n>-what-i-hide.md` by pattern.
- **Behavior logs:**
  - Digest `memories {name: n}`; the watch's baseline records each seat's memory seq, so notes written before a seat is first tracked still count.
  - `no-memories` anomaly after BW.NO_NOTES_MIN (2 days); the report has a per-day table.
- **Pitfalls:**
  - Python `open(p,'w')` on Windows writes CRLF. Use `newline=''`, or run `sed -i 's/\r$//'` after.
  - A merge once swallowed localcheck's warmup loop into a comment line.

Related: [[agent-memories]], [[runner-pacing]], [[behavior-logs]].
