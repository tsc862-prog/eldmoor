---
name: stage-setting
description: #431 slice 2 - stage_scene setting/at for meeting and social scenes, scripted fitSetting pick, town meeting trigger, view hand-off, test pitfalls
metadata:
  type: project
---

stage_scene (src/sim/staged.js) takes `setting` (a key of src/data/settings.js SETTINGS: house, tavern, chapel,
cellar, cell, shrine, hold; also its name or a plain word via SET_ALIAS: "inn", "interrogation", "ship's hold") and
`at` (a town, or "the inn in <town>" / "<town> forge": town spots inn, smith, quartermaster, chapel, square, gate).
Only INDOOR_STAGE kinds (meeting, social) use them; elite/ambush/trap/mystery ignore both with a note
(`note`, or `setting_note` on an elite/ambush preview). Unknown setting/town/building and an enemy-faction town
are refused with the valid list. `at` replaces `near` (near is now optional in the schema, default fellowship).

**Why:** owner wants the DM to play a talk in a house or tavern in town; staged scenes were refused in town before.

**How to apply:**
- Scripted pick `fitSetting(kind,{spot,title,frame,want,role})`: building (inn->tavern, chapel->chapel), then the
  settings rows' `words` on title+frame, then want+role, then meeting->tavern / social->house. No dice. Runs only
  when at names a town and no setting was given (`setting_picked` in the result, `picked` in the DM log detail).
- Town scenes: the person is a create_npc home:'town' at the spot (default spot from the setting), waits
  STAGE.TOWN_WAIT_MIN 720 game min; tick opens the scene when any living, visible member is inside the town rect
  (+TOWN_PAD), state 'town' included (field() excludes town members, so the town path has its own list).
- rec.setting / rec.town / rec.spot -> ctx.setting / ctx.town; render/sceneview.js sceneSpec honours ctx.town and
  plays an indoor kind with a named setting indoors even out of town ("A house in <region>").
- dm_status.staged carries `settings` {key: name} and `settings_note`; standing orders in scripts/dm-agent.mjs and
  fellowshipNeeds (all in town -> "stage_scene kind meeting or social with at").
- Test pitfalls (dmcheck 1b2): create_npc maxActive 6 - drop the staged wanderers and their S.levers.active rows
  between stagings; reset only `create_npc*` keys of S.levers.cd (other sections rely on theirs). In heredoc Python
  edits on this machine `\\` collapses to `\`: use chr(92).
- `npm run sim` output is not seeded; prove "unchanged" with `node scripts/professioncheck.mjs --hash` against a
  `git archive origin/main` copy in the scratchpad.

Related: [[staged-scenes]], [[dm-flat-tools]].
