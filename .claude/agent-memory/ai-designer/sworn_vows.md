---
name: sworn-vows
description: swear_oath/renounce_oath (#526): a.vow in src/sim/vows.js, kinds, costs, where it is read, import-cycle trap
metadata:
  type: project
---

A hero's own vow is `a.vow` (separate from the sim's oath `a.goal`), one at a time, made by `swear_oath {text, kind, about, days}` and broken by `renounce_oath`. Kinds slay/recover/reach/protect/vow; detection via `vowEvent` (first line of `goalEvent`) and `vowTick` (end of `goalsTick`), both only when `a.vow` exists, so no RNG and scripted worlds are untouched (hashcheck equal).
**Why:** owner wanted heroes to bind themselves on purpose; keeping/breaking must reach memory, quest log and the DM.
**How to apply:** slay/recover/reach lapse as `expired` (not a break); protect and free vows are kept at term end; a protected companion's death fails it. Renounce costs 4 bond with the protected companion, 1 with witnesses, a `vow` landmark, a Chronicle line, `a.vowBroke` (a DM thread kind `broken` for 3 game days in company.js openThreads). Vow shows in quests (kind oath, from 'sworn vow'), `self.sworn_vow`, `status.vow`, DM fellowship_view member `vow`.
Trap: persona.js must not import vows.js (import cycle breaks fellowship.js HEALERS); persona computes days left inline.
[[quest_log]]
