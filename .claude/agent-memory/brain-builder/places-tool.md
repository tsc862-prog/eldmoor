---
name: places-tool
description: #414 places tool: known set = knownNames (same as move_to/hunt) + DM markers in sight; region distance from nearest ZPTS; kind/about/near args; heredoc backslash pitfall
metadata:
  type: project
---

#414 `places {kind?, about?, near?}` (player.js `knownPlaces`/`placesList`, read only, no RNG): entries from
`knownNames(a)` (lore places + friendly towns), so every name works in move_to/hunt {where}; a lair is shown as
"Kragmaw's lair" with `go: "Kragmaw"`. DM `S.places` markers appear only while within `sightOf(a)` (kind `place`);
planOne got a matching `markInSight` branch so move_to takes them then. Heroes never *learn* DM markers in lore
(lore.js has no hook for S.places), so "in sight" is the honest version.
Each entry: name, kind, known (been/heard/home), way ("southeast, 17 tiles (about an hour on foot)", 3 game min a tile),
word (jobRumour: public gate talk), creatures (lore entries whose `z` holds the region, with lore threat words),
learned (placeWarn notes). Region distance: nearest sampled ZPTS point, "here" when `from` is inside it. Max 12.

**Pitfall:** writing JS through `node - <<'EOF'` with a template literal turned `\b` into a backspace char and
`\d` into `d` in playcheck; write test code with a .cjs file that uses plain strings, or Edit, then `grep -c $'\b'`.

**How to apply:** new place-reading tools reuse knownNames/knownPlaces; prove unchanged sim with professioncheck --hash
(1733832012 on 2026-11-02 main). Related: [[hunt-where]], [[tool-quickwins]].
