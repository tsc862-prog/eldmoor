---
name: camp-refusals
description: #400 rules for camp and proposal refusals - campBlock text, second break_camp is a yes, non-leader break_camp proposes, refusals name the open proposal
metadata:
  type: project
---

Owner direction (2026-11-02): agents get maximum agency, so every refusal names the legal next step.

- `campBlock(a)` in camp.js is the one text for orders refused at camp (move_to, lead_to): camp end, leader, and the way on (leader: break_camp; others: vote(id, yes) on an open break_camp, else propose break_camp).
- `rest` at camp returns ok ("You rest at camp"), since resting is what camp is.
- A second `propose break_camp` or a non-leader `break_camp` while one is open is a yes vote on it (`secondBreak` in player.js); with none open, a non-leader `break_camp` opens the proposal. Only break_camp seconds: a duplicate job/other may differ in content, so those refuse but name the open one and its vote call.
- Done in the player tools only, not council.propose, so the scripted crypt/raid call path (council.js line ~201) and the seeded hashes stay unchanged.

**Why:** the audit counted 31 duplicate break_camp, 59 move_to and 21 rest refusals at camp; qwen retried them blindly.
**How to apply:** new refusals at camp or in the council should reuse campBlock / openNote / noProposal rather than writing a bare "cannot".
Test pitfall: with live links (`setRunnerLinks(()=>'connected')`) a proposal opens a Table decision scene and votes are counted there, so step the world before asserting the outcome.
