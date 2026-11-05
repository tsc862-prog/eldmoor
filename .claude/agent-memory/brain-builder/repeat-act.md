---
name: repeat-act
description: #801 runner side - repeat-act flag, REPEAT_ACTS allowlist, repeated-act anomaly, mock-pose, act:false not counted
metadata:
  type: project
---

`actSig(stat.acted)` in scripts/local-agent.mjs: the turn's ONLY call the game answered (`stat.tried`: accepted OR refused, not a schema rejection or an offline answer), and only if it is emote, say, party_say or whisper; key = name + sorted flat args. Same key as `L.lastAct` -> `stat.repeatAct`: turn line "empty turn (repeat-act: the same emote as last turn)", flag `repeat-act` (behavior-turn.mjs), `localWorked` false, counts in `L.emptyRun` (fresh context after 2) and `--max-fails`. Behavior anomaly `repeated-act` (behavior-log.mjs, from the flag). A call whose result says `act:false` is no longer counted in `stat.acts` (#814 unseen emote).

**Why:** a local model repeated one accepted emote every turn; the game guard (#814) alone also catches it but the runner flag works without it.
**How to apply:** never add wait/hunt/move_to/follow/rest/scene_act/abilities/trade/reads to REPEAT_ACTS - consistent play is not a loop and a wrong flag stops a live runner. Test: `mock-pose:1b` in mock-ollama, localcheck block E2.

**Gotcha (CI, after #814):** a call the game refuses (ok:false, e.g. "You already did that") is NOT `stat.rejected` (that is schema errors only), so the turn counted as worked and the fresh-context turns reset the streak; hence the key uses tried calls, not acted ones.
