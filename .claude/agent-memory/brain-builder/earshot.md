---
name: earshot
description: #395 earshot tool and brief.earshot header line; shared hearer helpers sayHearers/shoutHearers; spatial-index pitfall in tests
metadata:
  type: project
---

Issue #395 (owner request 2026-11-02): read-only hero tool `earshot` (src/sim/earshot.js) and a one-line `brief.earshot`
in the pace brief, shown as "In earshot: ..." by `earshotNote` in scripts/pacing.mjs (inside talkText for local and
Fellowship Claude turns; appended to Claude hero turns in agent-player.mjs).

**Why:** agents only learned who heard after speaking; the owner wants characters to know their speaking range first.

**How to apply:**
- The answer must come from the same sets the speaking paths use: `sayHearers(a)` (chat.js, used by speak and the say
  tool) and `shoutHearers(a)` (council.js, used by partySay) plus `shoutRange` (reach.js). Change reach there, never in
  earshot.js. `EAR.TALK` (4) must equal player.js `PK.TALK` (a literal: importing EAR into player.js hits a TDZ cycle earshot->council->fellowship->player).
- Header line form: "say reaches Gashka and 6 townsfolk; a shout (12 tiles) reaches Gashka, Gorzar; talk to <up to 4> and
  N more; too far for a shout: Neshim, Ssathoth (send_courier)"; null when nobody hears a say/shout and nobody to talk to.
- Far companions are names only (in-game channels #123); townsfolk count only in the header, named in the tool.
- Test pitfall: `sayHearers` reads the spatial index, rebuilt each step; after teleporting heroes in a check, `step(1/60)`
  before calling earshot or say (the real say has the same lag, so this is correct behaviour, not a bug).
- Seeded hash unchanged (professioncheck --hash 4011902237 / 2225542050 on 2026-11-02). Related: [[in-game-channels]], [[runner-pacing]].
