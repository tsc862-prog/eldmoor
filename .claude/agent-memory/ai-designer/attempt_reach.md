---
name: attempt-reach
description: "#864 why ruling voices lost calls (not the Claude slot), the real-time wait, wound parsing, retry, narrator invitation"
metadata:
  type: project
---

Ruling voices never lease a Claude slot; only the DM's main turn does. The `[pace] waiting for a Claude slot` line beside the aborts in dm.log was that turn, so #864's first theory was wrong.

**Why:** "Request was aborted" is `AbortSignal.timeout(seconds_left - 0.4)`, so those calls had 2.1-3.0 s left at pickup: the budget + PICKUP_MS cap from the post had bitten. 21 voice aborts in 326 lines before the page-stall work (#733/#736), 0 in 133 after. Not proven that the stall caused them (old lines had no `left`, and the repeated "call 2" stays unexplained). The later losses were different: both Nov 5 rulings were refused `wound` effects, never retried.

**How to apply:**
- A wait is real time only: `WAIT_GM` 60 game minutes was 1.25 s at 8x. Do not add a game-clock cut back without scaling by speed.
- `r.pick` gives a call 12 s for pickup only with a voice running; a seat with no voice keeps the 4 s cap.
- The voice schema requires `value`, so every effect form must tolerate one (`parseEffect` splits all kinds but move).
- The only open-world attempts (Snaggol, twice) followed a DM narrate describing a thing: hence `a.dmSaid` and the header line. Keep it general: never echo the narration.
- Read a `[ruling]` line's `left N s` first when a live run shows losses.
See [[invitations]].
