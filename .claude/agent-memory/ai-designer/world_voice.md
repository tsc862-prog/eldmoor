---
name: world-voice
description: #164 - scripted world chatter is muted behind S.worldVoice='dm'; only the DM voices world characters who meet the Fellowship; how the mute keeps RNG identical
metadata:
  type: project
---

`S.worldVoice` ('dm' default, 'scripted' = old barks) in state.js. `say()` (chat.js) still picks its line
and sets chatCd, then returns for non-`fellow` heroes. `npcSay()` (npcs.js) is the same: line picked,
chatCd set, delivered only if a Fellowship member is within HEAR (the scripted DM voices the NPC, entry
tagged `dm`) or `opts.dm` (agent `talk`). Table/camp/staged lines are untouched (members or scripted DM).

**Why:** owner wants only the DM speaking for world characters that interact with the Fellowship, and
seeded sims must not shift. **How to apply:** new scripted speakers must pick their line first, then
check `S.worldVoice`; the Settings button (`vChat`) is now the Developer "Scripted chatter" switch.
Seeded 60-min run: identical deaths/levels/honor in both modes, chat lines 771 -> 479.
