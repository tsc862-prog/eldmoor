---
name: whisper-emote
description: #627 hero whisper/emote tools: src/sim/aside.js, entry flags, limits, hooks, check pitfalls
metadata:
  type: project
---

`whisper {to,text}` and `emote {text}` live in `src/sim/aside.js` (ASIDE: WHISPER 2 tiles, 200/120 chars, 6 and 10 a game hour via `a.whispAt`/`a.emoteAt`). Chat entries carry `whisper:true,to,toName` (target and sender buffers only), `emote:true` (say-range hearers) and `emote+veil` ("leans close to X", bystanders, no words). Hooks: `heardText`/`chat_read` in player.js, `heardLines` in talk.js, `channelOf` in behavior.js (emote/whisper channels), dmsight `hear` skips both, `chatLine` in ui/panels.js, `earshot` gains `whisper`/`whisper_range`. Repeat refusal uses `a.talkSaid` (whispers join it, emotes do not).

**Why:** owner's second tools review (#627): in-game channels rule, bystanders never get the words.
**How to apply:** new chat-entry kinds must be added to dmsight/channelOf/heardText. Check pitfalls: playcheck whisper lines must differ by >20% words or the repeat refusal fires first; never `keep()` the far member's own header in channelcheck (its own persona is a "leak"). The Table banner veil line was not added (chat only).

#646 follow-ups: `whisperTo` sets `sc.narr` ("A leans close to B.", never the words) when both sit in one Table scene (sceneOf from scenes.js), so bannerOf/tableView show only the veil. Fireside `listen` with a line is an emote: `apply` calls `emoteAct` (same validation, limits) and clears `act.line` so the beat has no spoken line and gives no talk-round credit; res reads "listens, and <act>". Check pitfall: in a turns scene, a member with no live link is reflexed in the same step as the previous turn, so tablecheck --fireside makes the live member emote (in the 6-round big-event scene). channelcheck opens its own scene (TABLE.mode must be 'auto' or bannerOf is null) and JSON.stringify of bannerOf/beats is circular.
