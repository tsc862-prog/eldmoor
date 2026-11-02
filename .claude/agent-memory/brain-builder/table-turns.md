---
name: table-turns
description: #163/#159 forced structured Table turns for local/OpenAI members, text-written call parsing, wait refusal, narration cleaning, talk.js no-repeat/met rule, deterministic autopilot check, live Ollama contention finding
metadata:
  type: project
---

Built 2026-11-01 on branch infra/table-turns (PR "Closes #163, closes #159"). Owner's live bug: qwen2.5:14b wrote `(scene_act("strike", "..."))` (and later `scene_act(deadeye, "...")`, unquoted ability id) as text under a made-up "CallCheck" label, then called wait; Table turns timed out.

- Protocol: pace brief ({brief:true}) now always has `scene` (null or {title, kind, frame, phase, keys, options, your_turn, so_far}; keys from optionsFor incl. ready ability ids), `heard` (last 8 party/aloud lines, own marked "(you)") and `met` (names). `'scene' in brief` tells a new page from an old one (old: runner falls back to status.table).
- Forced turn (scripts/local-agent.mjs sceneTurn): schema {option: enum keys, line: string maxLength 200} (strict OpenAI: no maxLength, additionalProperties false, line cut in code). ask = chatAsk(chat) (Ollama format / OpenAI chat({strict:true}) -> json_schema strict) or adapterAsk(anthropicAdapter) for Claude. Two asks max; a non-JSON reply holding a written scene_act still counts; then the runner calls scene_act. Two misses -> free localTurn. Turn line "| forced scene turn". chatAsk aborts at 110 s (past TABLE.liveMs the reflex acted).
- Claude members keep tool use; after a scene turn, if the brief still shows an unanswered scene, one structured Claude answer (member's model, effort low), cost counted into the run.
- parseTextCalls: <tool_call>, bare JSON reply, name({...}), name(k=v), positional literals mapped onto the tool's arg order; a bare identifier only as the FIRST value and not equal to the arg's own name (so `scene_act(option, line)` from the rules is not a call). Written calls run before native ones in the same reply. cleanNarration cuts written calls, separators, a leading tool name or CamelCase label containing Call/Check/Tool/... (names like McAllister kept).
- player.js wait refused on your own turn (your_turn, or phase frame and first in initiative): "It is your turn at the table: call scene_act with one of: ...".
- src/sim/talk.js (agent heroes only, no RNG): lineRefusal = sameness >= .8 against own last 5 lines, or an intro (own name + I am/I'm/my name/...) once met. Met = both a.talkHeard[b] and b.talkHeard[a]. Fellowship orders gained a no-reintroduction line; sessions lacking it get sess.system rebuilt.
- #159 cause: the autopilot block raced a world ticking at 8x (mobs, duels, regen). Fix: hold the ticker, seedRng(159), calm() each step (pvpT, mob scan, no fight state), playActAt = now-115, assert a.playAuto. 20/20 stable (scratch autopilot20.mjs).
- localcheck: 1b unit (live strings), F (Fellowship scene with mock-fumble: 5/5 agent 'press', ~3.4 s), G (mock-intro: 5/5 repeats refused, header shows heard/met). Pitfall: a killed runner keeps its claims; release with runner id `${hostname()}:${pid}:fellowship`.
- Live 2026-11-01 (spare port 18793, qwen2.5:14b): scene 1 resolved by agents in 18 s via free-loop scene_act; scene 2 hit reflex because the owner's own live game saturated Ollama (a 5-token chat did not answer in 120 s). No clean latency number for the forced turn yet; expected one short call (~300 out tokens max) vs 4-10 calls of a free turn.
