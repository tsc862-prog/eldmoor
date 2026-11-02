---
name: chat-left-column
description: Chat panel goes to the top of the left column at 2200px+ with a Fellowship; layout.js placeChat/moveKeep, localStorage eldmoor.chatLeft
metadata:
  type: project
---

Owner asked (2026-11-02) for the chat to be reachable without scrolling the middle column. layout.js `placeChat()` moves #chatSec to the top of #colL in the 3-column layout (default), back under the map in 2/1 columns. `moveKeep` restores list scrollTop after a move (a move resets it). `#chatSide` button in the chat tabs (wide only) flips it, saved as `eldmoor.chatLeft`. Taller is hidden in the left column (body.chat-left). Story and World stay stacked below the chat in the scrolling column.
**Why:** scrolling the map column to reach chat was awkward. **How to apply:** new uismoke checks go at the end of scripts/uismoke.mjs, before the `if(fail)` line.
