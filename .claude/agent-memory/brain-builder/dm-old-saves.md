---
name: dm-old-saves
description: #562 (slice D of #520) convertOldDm in save.js restore, DM-always-agent hard rule in CLAUDE.md, savecheck pitfalls
metadata:
  type: project
---

Built 2026-11-03 on brain/dm-old-saves (closes #562, last slice of #520; builds on [[dm-always-setup]]).

**Conversion:** `convertOldDm()` at the end of `restore()` in src/sim/save.js: a scripted/non-agent `S.setup.dm` becomes `DEFAULT_DM()` (Haiku); a closed or missing seat (`S.dmAgent` absent = pre-#66 save) opens via `setDmSeat(true)` plus one DM-log notice ("The DM is always an agent now: ..."; detail `notice, converted`). Runs once (seat open afterwards), no RNG.
**CLAUDE.md:** new hard rule "The DM is always agent-played" before the DM-first rule; DM agent section no longer says Open seat or a scripted-DM mode (reflexes #561, pause #578 named).
**savecheck pitfalls:** the world must `setDmSeat(true)` after `init()` or the child round-trip diff fails (restore opens the seat -> dmLog id differs). The v6 fixture check `!/"company":/` on the whole snapshot was flaky (chat shout lines carry a `company` name field); now tests agents/parties/table only.
Hashes unchanged (hashcheck all same).
