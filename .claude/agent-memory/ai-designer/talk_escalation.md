---
name: talk-escalation
description: #407 talk -> Table scene rules (talkscene.js): four reasons, once per conversation and reason, company present, scripted reply fill, test pitfalls
metadata:
  type: project
---

Talk escalation (#407) lives in `src/sim/talkscene.js`: `ESC` (words, limits) and `escalation()` are the one place the
rules sit; `talk.js` only calls the registered hook (`setTalkEscalation`) from `talkTo` (member's words) and `offer` (a job).

- Four reasons: `offer` (a job follow-up needs an answer), `bargain` (bargain words), `party` (a party word AND a matter
  word AND a company mate within HEAR of the person), `tense` (hostile person or threat words). Greetings, trade/buying,
  rumours, blessings never escalate. **Why:** owner decision 2026-11-02, everyday talk stays in the world (no pause).
- Once per conversation and reason (`c.esc`), `ESC.PER_DAY` 6 per company per game day (`C.talkScenes`), never while
  `S.table` is busy or Table is off. **Why:** a talk scene pauses the world at 1x; it must stay rare.
- The scene is PLAY 'all' for the company present (table.js `present()`: shout range of the speaker). Majority of
  accept(+won bargains) / decline(+lost bargains) / leave; tie = the speaker's pick.
- The person's answer goes through the conversation (`sceneReply`): DM agent voices it via the waiting call when
  listening, its `fill` line on silence (talkTick), else the scripted line at once.
- dmlog entries use `{heroes:[]}`: a 'roll' with heroes would trigger a `check` scene in table.js `due()`.
- Test pitfall: reflex members (no runner) resolve an 'all' scene in the same step the frame ends, so a scripted
  test must scene_act during the `frame` phase too. Captain/sellsword's scripted first reply posts a job, so talking
  to a captain always opens an offer scene (pick smith/innkeeper for plain-talk tests).
- Agent-only path: seeded hashes (`tablecheck --hash`, `--hash-talk`, `professioncheck --hash`) unchanged.

Related: [[table_simultaneous]], [[table_per_company]], [[emergent_parties]].
