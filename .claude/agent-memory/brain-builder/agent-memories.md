---
name: agent-memories
description: #155 per-agent searchable notebooks (heroes + DM) - store shape, ranking weights, header, caps, letter rule, mirror protocol, owner's free-form requirement, test pitfalls
metadata:
  type: project
---

Built 2026-11-01 on branch ai/agent-memories, PR #162 ("Closes #155").

- **Owner requirement (2026-11-01):** memories are free-form. The agent chooses any title, text and tags, and `about` is optional. Nothing is validated beyond the caps.
  - **Why:** the owner asked whether agents can write memories that don't match predefined criteria.
  - **How to apply:** prompts name kinds of notes only as examples ("anything you want to keep: for example ..."); never add required categories.
- **Store:**
  - Hero: `a.memories = {seq, notes, arch, v, day:{d,w}}`.
  - DM: the four `S.dmAgent.notes` sections plus `D.arch` and `D.mv`; each note carries `sec`.
  - The resolved about-link field is `rk`, NOT `ref`: save.js restore turns objects whose `.ref` names a pool into entity references.
- **Ranking:**
  - recall: title 3, tags 3, about 2, text 1 (prefix match), +1 pinned, + 2/(1 + days old); tag and about act as filters.
  - Header relevant(): a present link 6, a name in head 3 / in text 1, scene and vote words up to 3, pin 1, recency/4 bonus.
- **Header:** paceBrief().memories holds `{id, title}`. briefText (local turns) includes it; Claude turns append memoryNote(b0); DM gets dm_status.relevant_notes in dmTurnPrompt.
- **Letter:**
  - A member's newest pinned note tagged `letter` syncs to S.fellowship.letters[slot].
  - notebookOf delivers it to the next slot holder once the writer is dead. No fellowship.js hook was needed.
- **Mirror:**
  - mirrorDirty(sentMap) returns `{key, sig, seat}`. The bridge sends `{type:'mirror', seats}` every 2 s and clears its sent map on reconnect; play-headless writes directly.
  - scripts/memory-mirror.mjs writes under `AGENT_LOGS || logs/agents` / `<world>` / `<id>-<slug>` / `memory`, keeps a write cache, and unlinks stale `<id>-*.md` files.
- **Tests:** checks live in channelcheck section 6. Use HE.fall() then run(2) to trigger a Fellowship replacement. NB.WRITES_PER_DAY is mutable, so tests raise it.
- **Pitfall:** git commands that include long compound shell lines get refused by worktree isolation. Write python edit scripts to the scratchpad and run them with a separate command.

Related: [[in-game-channels]], [[runner-pacing]], [[dm-agent]].
