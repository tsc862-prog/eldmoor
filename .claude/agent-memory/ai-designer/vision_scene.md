---
name: vision-scene
description: #639 vision scene kind - staged in staged.js, kind hooks in sim/vision.js, rest/place trigger, reveal only if someone looked, summary keeps no reveal
metadata:
  type: project
---

`stage_scene` kind `vision` (#639): no cast, no dice, no complication. Scene hooks live in `src/sim/vision.js` (registered from
`sim/index.js`, NOT imported by staged.js: staged.js -> vision.js -> arrival.js hit a company.js import-cycle TDZ crash); staged.js
reads the kind through `kindHooks('vision').stagedCtx` like interrogation.

Rules and why:
- near a member/company/"fellowship" -> `rec.trig='rest'` (opens when one rests: state camp, or town with pq[0].kind rest); near a
  place/x,y -> `trig='place'` (a member within MEET_R). `visionWho` resolves members even in town (whereOf refuses town).
- Never opens while any company member is in fight/duel/assist/raid/dungeon, has `raid`, or is in CRYPT.group.
- Frame narration goes only to those within shout range of the member it found (other staged kinds send to the whole company).
- **The scene summary names who looked, never the reveal**: table.js outcome() notifies every company member and writes the public
  chronicle with the summary (channelcheck caught it). The reveal goes only into present members' notes/lore.
- Reveal/place/creature land in lore only if someone chose see or ask; all turn_away = nothing learned (the choice shapes it).
- `noAttempt:true` on the kind hides the free action (attempt can wound; a vision must not harm).
- Reflection moment kind 'vision' is raised in the kind's outcome before table.js's 'scene' moment (they merge; why lists both).

Checks: `tablecheck --vision` child, channelcheck vision block. Hashes unchanged (opens only when staged). See [[interrogation_camp_scene]], [[fireside]].
