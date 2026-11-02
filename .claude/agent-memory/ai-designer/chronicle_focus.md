---
name: chronicle-focus
description: Chronicle "Fellowship only" filter (chronicleFocus) rules: guild lines kept by exact '<TAG> Name' label of a living member's guild (#341); hall board ff jobs log one line from boardLog (#351)
metadata:
  type: project
---

`chronicleFocus` (src/sim/fellowship.js) is a read-only UI filter; the sim never calls it, so seeded hashes cannot move.
Guild lines (#341) are kept when a part's `t` equals `guildLabel(g)` = '<TAG> Name' for a guild a living member holds.
guilds.js, guildfocus.js and rivals.js each build that same label with their own private `tagTxt`, so a change to the
label format there must change `guildLabel` too.

**Why:** the Fellowship's own guild never takes a focus (guildfocus skips it), so most kept lines are banners, joins,
leadership and rivalries naming it, not focus changes.
Hall board (#351): `boardLog` in dm.js calls `hallLine` only for `h.ff` hooks: one Chronicle line naming the town, the
giver (a townsperson, never the DM), the job kind + region (T.name, not the RNG-drawn title) and the member (oath-bearer,
else party leader) as a hero part, so chronicleFocus keeps it with no change. Untagged postings write nothing (about 1
line a game day; ~2200 Chronicle lines per seeded hour, 24 hall lines). Chronicle text is not in any seeded hash.
**How to apply:** guild test cases live at the end of scripts/uismoke.mjs; hall-board cases in the `--ffbounty` child of
scripts/dmcheck.mjs. `npm run sim` is unseeded; prove "unchanged" with `focuscheck --hash` and
`professioncheck --hash` against origin/main's file. Related: [[guild-focus]], [[guild-rivals]].
