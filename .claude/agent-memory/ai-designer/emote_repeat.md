---
name: emote-repeat
description: #801 emote repeat guard in aside.js, unseen emote act:false, what was left for the runner
metadata:
  type: project
---

emote refuses text 80% like one of the last 5 emotes (`a.emoteSaid`) or lines (`a.talkSaid`), before the hourly allowance, same ok:false as say's repeat. An emote with no one in earshot returns ok with `act:false` and a note; playerAct skips the went-through bookkeeping when `r.act===false`.

**Why:** a local model posed six times in a minute, unseen, and the runner never counted it as empty.
**How to apply:** use `act:false` for any tool result that changes nothing. The runner-side `repeat-act` flag and `repeated-act` behavior anomaly (issue #801) are brain-builder's and not done here.
