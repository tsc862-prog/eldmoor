---
name: chat-lines
description: Owner rules for the Chat tab (#145 feedback) - compact lines, no mind badge, own-name prefix stripped, 200-char refusal, repeats collapsed
metadata:
  type: feedback
---

Owner on the Chat tab: "this looks horrible. We don't need the agent label in chat because the goal is that all Fellowship members will be agents."

- One line per message: `time [Party] Name: text`, with a hanging indent (`li.chl`). The name is bold in its role colour, using class `fmn`. Never use `fm`: that is the roster's grid row, and it broke the line before.
- No mind or model badge in chat. The model goes in the name's title attribute.
- `chatGroups()` collapses back-to-back identical lines from one speaker into one line with `×N`.
- Sim side: `spokenLine(a, text, max)` in `src/sim/council.js` strips a leading own-name prefix. A line over 200 characters is refused for agents, with an error the model sees. Scripted camp lines are cut at a word boundary with an ellipsis. Never cut mid-word silently.

**Why:** all Fellowship members will be agents, so a badge is noise. Truncation mid-word read as broken.
