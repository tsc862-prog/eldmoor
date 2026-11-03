---
name: whisper-dream
description: #523 DM tools whisper and dream - delivery shape, limits, table "leans close" via S.table.narr, check pitfalls
metadata:
  type: project
---

`whisper {hero, text, as?}` and `dream {hero, text}` in `src/sim/dmagent.js` (tool rows in `src/data/dm-tools.js`).

- Whisper: needs the hero in `S.table.ids` or within `DMA.WHISPER_R` (4) of the placed person `as`. Lands in only that hero's `a.chat` as text `(whispered) ...` (from = npc stub or NARRATOR, `whisper:true`), so chat_read and the player.js watch loop make the soft event. Table: sets `S.table.narr = "<npc|Someone> leans close to <hero>."` (existing narrate slot, no table.js edit); overwrites a real narrate line. 8/day (`day.wh`). DM log entry has `voice:'whisper', hero` and no `text` key (watcher reads words in the Chat tab).
- Dream: queued in `S.dmAgent.dreams` ({hero,text,day,slept}); `dreamTick()` (called in `step()` after `dmTick`, no-op when empty so seeded hashes do not move) marks `slept` while the hero is `state==='camp'` or town with `pq[0].kind==='rest'`, and delivers `You dream: ...` (chat entry `dream:true`; `heardText` returns it bare, `hearWake` gives 2) plus `moment(h,'dream')` when it stops. Agent heroes only (`h.player`), 2/day, max 3 waiting.
- Pitfalls: `JSON.stringify(S.dmLog)` and `T.bannerOf()` are circular - check `e.detail` keys and `.narr` instead. Stepping the sim with a faked `state='camp'` loses the state (campTick); call `dreamTick()` directly in checks. Planted-secret leak audit (`plant`) is separate from `secret()` used for these lines.
