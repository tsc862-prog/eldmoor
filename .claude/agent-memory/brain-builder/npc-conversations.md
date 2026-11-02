---
name: npc-conversations
description: #170 NPC conversations - talk.js state and person record (mood/warmth/hostile/fmem), wait budgets, npc_call/npc_say{conv}/npc_offer protocol, talk voice runner, scripted fallback, combat outside the gate, test pitfalls, measured latency
metadata:
  type: project
---

Built 2026-11-01/02 on branch ai/npc-conversations (PR "Closes #170"), on top of #167 (world voice muted).

- **Sim:** src/sim/talk.js (+ data src/data/talk-lines.js: ROLE_TALK want/offer, ROLE_JOB, ROLE_STOCK, TALK_LINES). S.talks {seq, call, cur, past, day{lines,offers,opened}, stats}. talkTick() in index.js after npcsTick (no-op without S.talks).
- **Who opens:** only `a.fellow` heroes (talk with optional `text`, or `say` via addressed(): open conv within HEAR, a person named within TALK_R 6, or one within NEXT_R 2 with no hero within ALONE_R 4). Background heroes keep the old canned npcSay greeting. Staged meeting/social finish() opens one via talkFromScene (w.want now set on the wanderer).
- **Person record (coordinator ask, for the UI's dispositionOf):** p.mood friendly|neutral|hostile from p.warmth -10..10 (>=3 friendly, <=-4 hostile), p.hostile once they turned on the party, p.fmem {talks,last,notes[{d,t,text}],lastWhy}. Initial warmth from levers attitudeOf. Trade +1 once per conv, leave -1, combat -10 + hostile, DM npc_say/npc_offer warmth -3..3.
- **Waiting:** Date.now only read with the seat open. dmHeard(tool) on every dmAct: npc_call poll within POLL_MS 6 s -> wait VOICE_MS 8 s; any DM call -> TURN_MS 40 s; else scripted at once inside the tool call (answer in the result). WAIT_GM 720 game-min cap. Tests mutate CONV.VOICE_MS.
- **DM protocol:** npc_call (act false; idle polls not logged in calls or relay) -> npc_say {npc, conv, text<=200, warmth?, remember?} (outside the 16/day npc_say cap; DM_LINES_PER_DAY 40) -> npc_offer {npc, kind trade|rumour|job|combat|blessing|leave, ...} one per exchange, DM_OFFERS_PER_DAY 12. Illegal kinds are refused BEFORE the text line is spoken. dm_status.conversations (waiting first); npcs shows `fellowship` record; read_dm_log kind 'talk' (entries detail.by dm-agent|scripted, heroes [] - tablecheck requires the by tag).
- **Follow-ups:** trade -> p.trade {conv,until,fac}; buy/sell {npc} (or out of town, the nearest open trade) via npcBuy/npcSell, prices x(1-warmth*.02), +10% outside town. rumour -> optional mark_place in a region (spot from ZPTS passing spotErr) + member memory. job -> post_hook forHero at the member's town. combat -> stageScene ambush/elite; in town staged at a point LK.TOWN_CLEAR+.5.. tiles out from the gate (spotErr refuses within 8 tiles of a gate). blessing priest/hermit only (a.blessed=1). leave -> p.snub[heroId] 240 game-min.
- **Hero side:** answer lines are chat entries with e.talk=conv id, e.by, e.mark ('[trade opened]' etc.); hearWake returns 2 for e.talk. Events "[mark] hint" with notify(...,true,2).
- **Runner:** scripts/dm-agent.mjs talkVoice (like tableVoice): polls npc_call 1.5 s idle / 0.4 s hot, one structured call (schema text, offer enum, about, region, warmth enum strings, remember), then npc_say + npc_offer. --talk-model / DM_TALK_MODEL (default the table model, Haiku 5.5), --no-talk-voice -> waitTurn starts a turn at once when dm_status.conversations has a waiting one (after min gap) and talkNote(st) is appended to the turn prompt.
- **Pitfalls:** dmcheck section 1 leaves the seat open and recent dmAct calls, so "silent seat" tests must setDmSeat(false); PK.RATE 12 acts/game hour - reset a.playRate in tests; Python on Windows writes CRLF (harmless: .gitattributes eol=lf).

Related: [[dm-agent]], [[staged-scenes]], [[in-game-channels]], [[agent-memories]].
