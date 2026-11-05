---
name: chatbot-voice
description: #837 chatbotVoice guard in local-agent.mjs - phrases, false-positive count on real logs, refusal note, flag plumbing
metadata:
  type: project
---

Cause: a refused/late scene_act came back as a bare `{"ok":false,"error":"Your turn has passed."}` tool result; qwen2.5:14b answered it as a user ("What would you like to do next?").

Fix (scripts/local-agent.mjs): `chatbotVoice(text)` (12 regexes: what would you like to do, please let me know, could you please specify, it seems like you/your, your last action, here are your options, you can check/try..., the game is expecting...). On a no-call reply or json narration: re-prompt once with REPROMPT_VOICE, the reply is stored as "(not narration)"; at turn end a chatbot narration is cleared, `stat.chatbot` set, empty turn when no acts. Every refused tool result (ok:false) gets TOOL_NOTE appended ("not a message from a person"); shown text is the unchanged one. Flag `chatbot` in behavior-turn.mjs, column in the report's per-seat table, `localWorked` false when chatbot and no acts.

False positives: 0 of 1646 real narrations (1154 qwen, 492 Claude) in logs/behavior/eldmoor/turns.jsonl; 12 hits, all the 08:47-08:49 cluster (lines 1763-1802). Loose "it seems you have ..." and "the game has paused" were FPs and were tightened out.

Pitfall: writing regexes via node heredoc halved `\b` into a backspace char; check with `od -c`. Detector only on narration, never on tool args or forced scene answers.
