---
name: polish2
description: "#979 second polish: fog and dusk water, gatehouse deco pair, harbour from spec pier, cast shadow moved into the light map; traps found on the way"
metadata:
  type: project
---
Second pass on the showcase (2026-11-06, PRs #1001, #1005, #1006 and the shade PR).

- Dusk colour: under multiply a strong blue survives a violet ambient, so `sheen.js` follows the ambient's warmth and multiplies its own tint when the ambient dims. Pink fog was the ambient at 20:00 having g below r and b.
- A gatehouse stands over walkable ground: paint in the chunk for far views AND push two y-sorted deco (`flat`, `veil`): back at the ring's top, front at its foot, so a hero in the passage is between them. East and west gates cannot show an arch.
- `flat` on a deco = no blob shadow, `veil` = company ghost behind it, as trees.
- Harbour is keyed by spec `pier` plus tiles (harbour.js). Painted water, glints, foam and sheen are all separate: anything laid over water tiles must tell water.js (`quayOver`) and sheen.js (`quayLip`).
- Bridge tiles are wider than the deck art (23 of 32 units): a mask cleared by tile leaves raw water that a warm hour turns green. `bridgeDecks()` gives the real deck.
- Cast shadows live in the light map now (`castInto`): one quarter-res multiply darkens figures, no per-figure work, cheaper than the old full blit.
- **Why:** owner liked the showcase; reviewers listed these as weak.
- **How to apply:** frame A/Bs here vary 30% with the director's framing and whatever else the box runs; repeat a row alone before believing it. Bash heredocs with backticks and `${}` in the same call failed to parse: use Write for such files. Harness idea: own vite in the script, `go(place,hour)` in cinema, see [[gpuframes]], [[showcaselight]], [[lpcwalls]].
