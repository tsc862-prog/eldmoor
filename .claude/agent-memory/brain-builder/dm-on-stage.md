---
name: dm-on-stage
description: #1017 why the DM was silent (call id collision, kinds with no DM call, prepare-only orders) and sceneframe.js, narrvoice.js, dmnames.js, dmstage-run; protocol, caps, measured latency and cost
metadata:
  type: project
---
#1017 (2026-11-06), owner's Vale session, Haiku DM.

Causes found:
- tableVoice deduped on `call.id`, but ids start at 1 in every scene: after session zero's call 1 the fireside's call 1 was skipped (picked up, never answered, fill at the deadline). Same for every later first delve room. Fix: `call.key` (`callKey`).
- `dmOf(sc)` only returned hooks for opening, arrival, fireside, staged and a few kinds: votes, ambush, elite, choice, check never asked. Fix: sceneframe.js, one `voice` call, only when `sc.pause && voiceLive`.
- Standing orders said "preparation, not running scenes", "speak sparingly", "a quiet turn is one act or nothing". Old sessions keep their prompt, so withDmStageOrders REPLACES those sentences.
- EVENT_MAX 3 was spent by mid-morning. Now 5.
- Vale campaign notes name things not on the map ("the Cold Forge"); "Greymane" is a real ELITES row but aboutOf only took elites alive in S.mobs.

Protocol: narrator_call {budget_s, wait_ms} -> call {call, kind town|region|place|dawn|spoke, what, where, members, heard, you_said, your_notes, their_words?}; narrator_say {call, text}; "" = silence. Intercepted at the top of dmAct like companion_call, NOT in DM_TOOLS (keeps agent context and tool map small). Goes through run('narrate', {_voice}).

Measured live on Haiku 5.5 before the change: frame 1.7-4.1 s against 8 s left at pickup, about 1.5k in / 300 out, $0.0003. Agent turn $0.002-0.008, average about $0.004.

**Why:** owner's D&D-first direction #1012: a DM should be heard. **How to apply:** a voice line is ~1/10 of a turn, so presence belongs in voices, planning in turns. narrate lines from voices carry e.quiet so they never start a hero turn; hero turns cost far more than the line. Local DM keeps the 8 s frame budget (table_call has no budget_s); a miss only leaves the game's line.

Pitfalls: never store hero objects on a scene (saved, circular). JSON-stringified tool results escape quotes, so a mock's regex needs `\\?"`. A hidden hero is refused as narrate near: speak_to and leadOf skip hidden. allScenes sorts by company id, so a test of ourScene's order must put the idle scene first. Heredocs with quotes break the Bash tool: write files with Write. `rm -rf` in a compound command gets the whole command refused, patches included.

Related: [[dm-voice-longpoll]], [[companion-voice]], [[dm-fellowship-first]], [[scene-ready]].
