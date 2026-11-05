---
name: dm-spoke-for
description: #750 rules - the fireside question is the fire's own; sim/spokefor.js cuts DM-voiced quotes of agent heroes in dmagent run(); exemptions and pitfalls
metadata:
  type: project
---

The DM never gives an agent-played hero words (#750, owner 2026-11-03 after "Ulgug speaks quietly: '...'" in a fireside frame).

- Fireside quiet-day topic is "The fire puts a question to <b>: <q>" (`tk:'question'`, `ctx.to`), and `ctx.asked[b]={name:'the fire',fire:1}` so b gets `answer`. No asker is ever named. **Why:** a topic written as "<a> has a question for <b>" was rendered as a's speech by Haiku.
- Guard: `src/sim/spokefor.js` `spokeFor(text,{names,allow})` (pure, no RNG) runs in `dmagent.js run()` (so whens firing narrate etc. are covered) on `VOICE_FIELDS` (table_answer, narrate, npc_say, whisper, dream, ruling_answer). A quote attributed to a living `a.player` hero cuts its sentence; all text gone = refused with `spoke_for`. DM log entries made by the call get `detail.spoke_for`; result gets `spoke_for` + `warning`; `dm_status.spoke_for_today`.
- Exemptions: the arrival newcomer on its own `voice`/`oath` call (the DM voices them until sworn, #452); a quote matching the hero's own words (`a.talkSaid`, scene beat lines, pending attempt `what`). "The hermit tells Ulgug: '...'" and "Ulgug listens as X says" pass (name must precede the speech verb within 3 non-stop words).
- Scripted fills are not guarded (hash safety; they never quote members after the topic fix).
- Behavior: game-side `dm-spoke-for` anomaly per cut (seat `dm`, evidence.model from the DM's latest turn); report counts per DM model (`spokeForLine`).
- Pitfall: bash heredocs in this environment eat `\\` - write Python edit scripts with the Write tool when they contain backslashes.

Related: [[fireside]], [[world_voice]], [[arrival_session_zero]].
