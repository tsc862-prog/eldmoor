---
name: fireside
description: #571 talk round the fire - fireside/debrief Table kinds (fireside.js), round hook in table.js, gating, line length and copy refusal, townsfolk memory, test pitfalls
metadata:
  type: project
---

#571 (owner: long conversations that build knowledge and the bio). `src/sim/fireside.js` registers `fireside` (PLAY 'turns',
3 rounds, 6 after a big event) and `debrief` (PLAY 'all', one round) via setSceneKind. table.js grew generic kind hooks:
`next(sc)` for more rounds (acts cleared, same order, sc.rd counts), `liveMs` (getter, so checks can shrink FIRE.LIVE_MS),
`view(sc,a)`, and `onSceneEnd(fn)` listeners. arrival.js exports its DM voice kit (pushCall/resolveCall/voiceLive) and
`voicedKind(k,onAnswer)` so table_call/table_answer serve the fireside (rounds 3-6 via table_answer).

**Why these rules:**
- Gated on `hasLinks()` + `agentsDecide` (like arrivals): the Fellowship is atTable even reflex-only, so without the host gate
  npm run sim would open firesides and every seeded hash would move. `FIRE.ON=false` for checks about other camp/DM things
  (campcheck pair/solo camps with live links, dmcheck world camps).
- Topics look back at most FIRE.DAY and since the last fire; founding landmarks ('fellowship' marks) are NOT big, or the very
  first fire is always 6 rounds about "swore into".
- Silent agent = listens (no invented words); a silent round ends the talk; late once = skipped all night (sc.lw).
- Owner bugs folded in: table lines were cut at 120 silently -> TABLE.LINE_MAX 600, refuse longer; two local members parroted
  the opening frame's job with names swapped -> scene brief `you` (name, persona, own oath, told) in scenePrompt + sameLine
  refusal (names stripped, >=6 words, .8 overlap). 'all' scenes never show others' lines before resolution (take() at resolve).
- Townsfolk: DM-voiced talk (c.dm after a DM answer) runs to 10 exchanges; p.hmem per hero.

**How to apply / pitfalls:** a check that opens a new NPC conversation consumes the gameplay RNG (readPerson's empathy
check) and shifts later dmcheck sections (a rescue scene appeared) - assert via TK.lastTime instead. In tablecheck keep the
"away" member pinned in town after the scene opens (autopilot walks it into earshot during camp gather).
Related: [[table_simultaneous]], [[camp_rest]], [[talk_escalation]], [[arrival_session_zero]].
