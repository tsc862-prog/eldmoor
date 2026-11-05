---
name: wish-invite
description: #829 wish invitations - where the sentence rides, once-a-day state, dusk schema object, DM evening note, route check
metadata:
  type: project
---

#829: nobody wrote a wish since #663 because only a standing-orders line invited it. Now:
- `wishInvite(holder)` in `src/sim/wish.js`: one sentence, once per game day per holder (`holder.wishInv` day), appended to refusals for a missing capability: hero unknown tool (`playerAct`), DM unknown tool / no such lever (`pullLever`, `whenCheck`, `dmAct`), a forbidden ruling effect (`ruling.js refuse`), council "Not available here" (player only). Runner-side `cleanArgs` unknown tool: once an hour per process (`wishInviteOnce`, local-agent.mjs).
- Dusk reflection: `WISH_ASK` in `pacing.mjs` (kind dusk only); `reflectSchema({wish})` adds `wish {tool,what,why,moment}` (strict: required, empty fields); `reflectWish` parses, `reflectTurn` sends it with `wish` (`stat.wished`). Claude gets the sentence with tool use.
- DM: `wishNote(st, sess)` in `dm-agent.mjs`, evening turns only, once a game day per session (`sess.wishAsk`); DM turns are tool use, no schema.
- Seen: Agent tab "Wishes: none yet", DM panel "Wishes: none yet", report "Wishes per seat per game day".
- Route proof: `wishcheck` posts `/play/call {tool:'wish'}` on a real attachPlay, pumps the watch, line lands in wishes.jsonl with the runner's model.
- No RNG; hashcheck unchanged. Pitfall: a python heredoc with `\n` inside JS strings failed to match; splice blocks with `sed -i 'Nr file'`.
