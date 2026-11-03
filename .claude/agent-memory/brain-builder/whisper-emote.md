---
name: whisper-emote
description: #627 hero whisper/emote tools: src/sim/aside.js, entry flags, limits, hooks, check pitfalls
metadata:
  type: project
---

`whisper {to,text}` and `emote {text}` live in `src/sim/aside.js` (ASIDE: WHISPER 2 tiles, 200/120 chars, 6 and 10 a game hour via `a.whispAt`/`a.emoteAt`). Chat entries carry `whisper:true,to,toName` (target and sender buffers only), `emote:true` (say-range hearers) and `emote+veil` ("leans close to X", bystanders, no words). Hooks: `heardText`/`chat_read` in player.js, `heardLines` in talk.js, `channelOf` in behavior.js (emote/whisper channels), dmsight `hear` skips both, `chatLine` in ui/panels.js, `earshot` gains `whisper`/`whisper_range`. Repeat refusal uses `a.talkSaid` (whispers join it, emotes do not).

**Why:** owner's second tools review (#627): in-game channels rule, bystanders never get the words.
**How to apply:** new chat-entry kinds must be added to dmsight/channelOf/heardText. Check pitfalls: playcheck whisper lines must differ by >20% words or the repeat refusal fires first; never `keep()` the far member's own header in channelcheck (its own persona is a "leak"). The Table banner veil line was not added (chat only).
