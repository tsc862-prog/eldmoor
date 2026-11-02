---
name: turn-hold
description: #240 stale orders - autopilot holds during an agent's open turn (cap 180 game min), refusals explain what changed since the last look, as_of on results
metadata:
  type: project
---

Agent-played heroes have a turn bracket (`a.playTurn`, player.js `turnStart/turnEnd/turnHeld`): opened by a pace wake
(player-host.js `hostPace`) or the first tool call, closed by the runner's next pace call or a `wait`. While held,
autopilot starts nothing new (no autopilot rest/hunt, no new prey for an autopilot hunt, no full-pack walk home, no
following the party out of town); fights, flee reflexes, walks and following an already-moving party go on.

**Why:** a local model's turn takes ~1 game hour at 1x; autopilot finished the fight and walked home, so the agent's
`fight(target_id)` was refused with no explanation (owner saw it live, 2026-11-01).

**How to apply:**
- Cap `PK.HOLD` 180 game min; after expiry a tool call does not reopen it, only a pace call/wait resets. With a host
  reporting links (`hasLinks()` in runlink.js) the hold needs `agentLive`, so a gone runner never freezes a hero.
- `markPlayer(on)` clears `playTurn`; checks that re-mark a hero rely on that.
- Last look = `a.playLook` from look, status, and only the first brief after a wake (`a.playFresh`): the relay's
  after-turn behavior-log brief must not count as a look.
- Refusals append "Since your last look (...)" only when the hero's own situation changed; the target note alone never
  triggers it. Results carry `as_of`, and `since_look` past `PK.STALE` 15 min.
- Scripted world unchanged: seeded fingerprints match main with and without a Fellowship (members with no runner play
  by reflex before the hold is consulted).
