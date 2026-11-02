---
name: chronicle-focus
description: Chronicle "Fellowship only" filter (chronicleFocus) rules: guild lines kept by exact '<TAG> Name' label of a living member's guild (#341); hall board half waited on #332
metadata:
  type: project
---

`chronicleFocus` (src/sim/fellowship.js) is a read-only UI filter; the sim never calls it, so seeded hashes cannot move.
Guild lines (#341) are kept when a part's `t` equals `guildLabel(g)` = '<TAG> Name' for a guild a living member holds.
guilds.js, guildfocus.js and rivals.js each build that same label with their own private `tagTxt`, so a change to the
label format there must change `guildLabel` too.

**Why:** the Fellowship's own guild never takes a focus (guildfocus skips it), so most kept lines are banners, joins,
leadership and rivalries naming it, not focus changes.
**How to apply:** the hall board half of #341 waited for PR #332 (dm.js boardLog); add it there once merged. Test cases
live at the end of scripts/uismoke.mjs. `npm run sim` is unseeded; prove "unchanged" with `focuscheck --hash` and
`professioncheck --hash` against origin/main's file. Related: [[guild-focus]], [[guild-rivals]].
