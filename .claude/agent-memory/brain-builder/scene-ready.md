---
name: scene-ready
description: "#682: members held until the DM's frame (framing/unwoken/heldBack), staggered wakes (wakeGapMs), hush, dmVoiceBusy + DM_FIRST_MS slot yield; test pitfalls"
metadata:
  type: project
---
#682 (PR #694, on top of #689): a paused scene holds its members while `sc.phase==='frame'` or an opening DM call (`c.op`, set by
table.js frameCalls on calls the scene's onFrame pushes) is undone: src/sim/scenewait.js `framing(sc)`, `unwoken(sc,a)` (sc.wk set
in open() only when sc.pause; `wk.done` when all woken; ids marked 1 or 'acted'), `heldBack`, `FRAMING` message. tableView gives
`waiting_for:'the DM'`; pace no wake; sceneOpen null; sceneDue false; scene_act returns `{ok:false, offline:true}`. table.js
`wakeStep` (in holdStep after the frame transition) notifies with `framedText(sc)` in seat order `TABLE.wakeGapMs` 1500 apart
(everyone-answers only; reflexMay members and those already acted take no slot); turn scenes wake all, then startTurn.
A proposal's vote notice is hushed (notify.js `hush`) when it opens a paused decision scene.
Slots: relay-mcp `dmVoiceBusy()` (a voice poll returned a call with seconds_left > 0, cleared by table_answer/ruling_answer/
npc_say{conv}, max DM_VOICE_MS 10 s); runners.mjs `/play/runner/slot` waits `DM_FIRST_MS` 2000 for non-dm keys.

**Why:** owner decision: members woke during "The DM is setting the scene" and took the Claude slots the DM's frame needed.

**How to apply:** tests that act right after openScene must step until `sc.wk.done` (tablecheck `settle()`/`PA`) or mark the
scene set (`sc.phase='turn'; delete sc.wk`). A member with no runner (reflexMay) is never held; its reflex resolves the scene as
soon as the frame is set, so a test answering for it must give it a 'connected' link. Measured in scenewaitcheck E: a 5 s mock DM
frame lands 6.7 s in; wakes 1.49-1.50 s apart.
