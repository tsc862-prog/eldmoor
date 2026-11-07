---
name: narrator-voice
description: #554 local TTS narrator voice - engine contract, relay routes, cache, page queue rules, check pitfalls
metadata:
  type: project
---

Engine is any loopback server with OpenAI `/v1/audio/speech` (Kokoro-FastAPI default `http://127.0.0.1:8880`); non-loopback `TTS_URL` is refused so text never leaves the PC. `scripts/providers/tts.mjs`: status (voices from `/v1/audio/voices`), speak (one at a time, hash cache `logs/tts/<sha24>.mp3`, text cut to 500 chars, unknown voice falls to the engine's first), route hook in `createRelay({tts})`: `GET /tts/status`, `POST /tts/say`, `GET /tts?id=` (24-hex ids only). `/health` has `providers.tts`.

Page: `src/ui/sound.js` (Node-importable: pure `makeVoiceQueue`, `scanLines`; DOM only inside init/render), wired by two lines in `ui/table.js` (gate = Sound switch && gesture). Sources: S.table frame/narr, S.dmLog entries (kind agent, detail.voice narrate|npc_say), agent hero bubbles when "Heroes speak". First scan never reads the past.

**Why:** owner wants spoken narration, free and local. **How to apply:** new speaker kinds go in `voices.js` + `scanLines`; keep the queue rules (20 s drop, 3x/8x table-only) covered in `npm run ttscheck`. Not measured on real hardware (engine not installed by the agent); mock only.

Pitfall: heredocs with an apostrophe-heavy JS body failed in this shell; use the Write tool for new files.

#1015 (keeping up): kinds table/recap/npc/narrate/hero, AGE_MS table 60s recap 90s world 20s hero 10s; same `who` replaces a queued world line; BACKLOG_S 10 s of world speech; RATE 1.15 sent as `speed` (clampSpeed .7-1.5, part of the clip id only when != 1); heroes speak by default (own voice via pickVoice, table beats with `line` spoken in order); recaps = recapOfScene (title + 2 sentences of sc.summary when the scene closes) and dailyRecap (followed company's C.log, 3 weightiest kinds, from 06:00, once a day); Voices mode all|scenes|recaps. No model call. Not done: table waiting for the voice (would need a sim hook). Estimate CPS 15 at rate 1: a 600-char table line is ~35 s at 1.15.
