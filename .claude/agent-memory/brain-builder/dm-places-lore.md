---
name: dm-places-lore
description: #423 heroes learn DM-marked places (S.places) in lore.js: seen/heard/job-told, e.dm id, fade with marker, knownMark in planOne, learnJob, check pitfalls
metadata:
  type: project
---

#423: a DM place (`S.places` marker from mark_place / create_site / staged mystery) is learned like a landmark
(src/sim/lore.js): **seen** in `visit()` within the landmark sight radius (12*sightMul, event "You see X with your own
eyes."), **heard** in `hear()` (dynamic regex over S.places names, leading "the" optional; warning words mark it), **told
by a job** via `learnJob(a,h)` (zone + `h.data.place` -> DM place by name/coords, else a landmark) called from list_jobs,
take_quest and from `visit()` for jobs the hero holds or was offered (`a.loreJ` = signature of those hook ids).
Lore entry `a.lore.p[name] = {how, at, dm: markerId}`: public name only, never lever/reason. The entry is deleted when
the marker id leaves S.places (fades). Markers named like a region/landmark/town are skipped (`clash`) so their entry
never fades. move_to/hunt {where}: `knownMark(a,t)` branch in player.js `planOne` (before the town check), with placeWarn.

**Pitfalls:** lorecheck act() hits the 12 actions/game hour limit; reset `A.playRate = []` per call or a refusal test
passes vacuously. Fill post_hook boards by setting extra open hooks to `phase:'held'` (BOARD_MAX 8) and restore.
Never write JS regex through a bash heredoc/template literal (see [[places-tool]]); use Edit or python with plain strings.

**How to apply:** places tool (#414 `knownPlaces`) needs a branch for lore names with `.dm` (kind 'place').
Seeded hash unchanged: professioncheck --hash fellowship=true 1733832012. Related: [[places-tool]], [[hunt-where]].
