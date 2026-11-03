---
name: pay-mark-tools
description: #628 pay and #632 mark/unmark hero tools - pay.js, marks.js, where each hooks in, test pitfalls
metadata:
  type: project
---

pay (src/sim/pay.js) moves gold to a hero (any faction, 4 tiles) or a townsperson (findPerson); a person warms via the `set_attitude` lever (by:'agent', DM log sees it), 1 step per PAY.STEP 10 gold, 2 steps a game day (`p.paid`), and keeps `p.hmem[id].paid`. Chat line is `chat.act()` with the `emote` flag (shared with #627 emote). A vow of kind 'vow' that names the payee and talks of paying is kept (`vowPaid`); no existing oath type names gold. Bond event 'paid' (GAIN 1) only inside one company.

mark/unmark (src/sim/marks.js): own marks live in `a.lore.p[name]` with `mk:1` (told ones `mk:2`, `src`). planOne resolves them via `markAt` before DM marks; `places` shows kind 'mark'; `hearMarks` runs where a hero reads its chat (player.js watch), so any line in a.chat teaches. Render flags only for the followed hero (places.js).

**Why:** owner second tools pass; agent heroes only so seeded hashes do not move.
**How to apply:** pitfalls - this environment's tool layer turns `\b` and `\'` in heredoc/node -e edits into control chars or dropped backslashes; edit with the Edit tool or build backslashes with String.fromCharCode(92). move_to in a check hits the danger edge, pass force:'yes'. Check: scripts/paymarkcheck.mjs.
