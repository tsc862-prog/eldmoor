---
name: downed-agent
description: #658 (PR #706) agent side of the downed - aid phase gambits, presets that equal the old aid reflex, onAid hook, tellNear events, downed reflection, stabilize/tend/carry tools, test pitfalls
metadata:
  type: project
---
Death slice 5 (#658, PR #706, epic #626). Shapes worth remembering:

- Gambit phase `aid` (revive_ally, stabilize, carry{to}) is read only by `aidPlan(a,t,{noHealer})` from `callHelp` in downed.js (hook `onAid({plan,fire})`, hoisted function-holder to dodge the heroes<->downed<->gambits cycle). idlePick/fightRules skip phase aid. Union of every holding aid rule -> `a.aidHow {revive,stab,carry}`; scripted helpers have no aidHow (= everything).
- Presets keep the autopilot hash: healer [ally_downed->revive_ally, ally_downed&no_healer->stabilize], others [ally_downed&no_healer->revive_ally (potion), ...->stabilize]. no_healer = no healer NEARER to the downed than you is free (healers among themselves by freeness, others by eligibility). A third rule beyond the issue's two was needed because the old reflex gave potions.
- Old own lists migrate in `rulesOf` (flag `a.gambitsDown`); `edit()` calls rulesOf first so a refused edit cannot drop them.
- Downed reflection: reflect kind `downed` bypasses PER_DAY/GAP while a.state==='downed'; `reflectNow` true on urgent wake for it; `downedOver(a)` turns an unplayed one into 'lesson' on rise.
- Tools stabilize/tend/carry go through `aidOrder`; `AID_BREAK` tools (move_to, hunt, follow, fight, ...) end aid BEFORE the handler runs ('aid' is not in player.js `legal`).

**Why:** owner rule that every company decision belongs to the agent; the reflex had to become an editable rule without moving seeded hashes.
**How to apply:** new aid behaviour goes in ACTS phase 'aid' + aidStep `can(k)`; keep presets equal to the scripted reflex or label hash-change-ok. Pitfall: the Bash heredoc collapses `\\` to `\` (broke a JS `\'` string and a Python anchor) - write edit scripts with the Write tool. See [[places-tool]].
