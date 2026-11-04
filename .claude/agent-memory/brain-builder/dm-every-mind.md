---
name: dm-every-mind
description: #824 the DM on every provider: PROVIDERS one list, compat DM branch, mindSwitched, budget between turns, fitTools 1024 limit, dm-mind-cases, pitfalls
metadata:
  type: project
---

#824: `src/data/providers.js` `PROVIDERS` is the one list (MIND/SETUP/RUNNER/DM_PROVIDERS are the same array); pickers take `mindLists()`. New provider = add there + adapter + `isCompat`.

- DM compat branch in dm-agent.mjs (`gem` = isCompat): `over()` stops at budget also inside waitTurn (a voice can spend the last of it; before, a whole extra turn was paid). Final line carries `| run $` so the supervisor sees voice spend; voice spend otherwise only shows at the next turn line.
- `mindSwitched`: another provider sets dm.json aside and sets `sess.rolled`, so the first turn gets DM_RESUME. The local/compat branch used to ignore `sess.rolled`; it now reads and clears it.
- `fitTools` (openai.mjs): function descriptions past 1024 go to the system message. Limit is from developer reports, not OpenAI docs; never tested live. It would have 400ed every DM turn (stage_scene 3374) and every hero (swear_oath 1116) on real OpenAI, while all mocks passed.
- Not measured live: DM on OpenAI or HF has had no real call. Tools alone are about 57 KB (~14k tokens) per model call, so HF allowance drains fast. Voices use 8 s budgets on HF too; slow routed models will fall to the scripted DM.
- Budget is checked between turns, not inside one (Claude has maxBudgetUsd; the loop does not).

**Why:** owner wants the DM chosen like a hero; the setup page offered providers the runner refused, and the gate paused the world.
**How to apply:** `scripts/dm-mind-cases.mjs` is called from openaicheck, hfcheck, googlecheck; new provider checks call it too. Pitfalls: `/play/*` refuses a browser origin, only `/play/runner*` wants the page's; a repeated mock narration is an empty turn (mock-dm varies it); `when` after_hours takes `on: {h}`; notes_write needs `op`; `cat > file` with no heredoc hangs the Bash tool; long heredocs with quotes fail, use Write. Related: [[gemini-provider]], [[hf-provider]], [[budget-stop]], [[session-size]].
