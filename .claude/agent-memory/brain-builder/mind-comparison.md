---
name: mind-comparison
description: #280 Mind comparison section of behavior-report - how rows are keyed, what each column reads, pitfalls of the real logs, first real numbers qwen2.5:14b vs Claude (2026-11-02)
metadata:
  type: project
---

Built 2026-11-02 on branch brain/mind-comparison ("Closes #280"; #97 stays open for Google). Code: scripts/mind-compare.mjs (compareMinds, mindSection), called from scripts/behavior-report.mjs; checked in behaviorcheck section 6b with mock JSONL.

- **Row key:** hero id + name (ids are reused across new worlds, so id alone merges strangers) and provider/model.
  - Turn lines with `hero: null` are named from the digest that listed that id at that time.
  - The digest member carries `runner: {provider, model}` (the bridge adds it); its hours go to that runner's mind.
  - The relay writing a member's sheet (WRITE_KINDS from src/data/prompts.js) is folded into the member's playing row as "N by <model>". The overall table keeps the writer models apart.
- **Columns:**
  - Decisions are game Mind entries (src 'game'); fallbacks are rejected, late or offline.
  - Table answers are `scene_act` ok calls. Reflex Table turns exist only party-wide in the digests (no sim change was allowed), so they appear only in the overall line.
  - Close calls are digests at MC.CLOSE 25% HP or less.
  - Deaths survived counts companions who were seen in the same digest and fell during the member's lifetime. An early version matched on fellowship name; the same name recurs across worlds, so that over-counted.
- **Safety:** the whole report markdown now goes through scrub() (behavior-log.mjs). Death causes are printed, so a key there would otherwise leak.
- **Real logs, as of 2026-11-02:**
  - Real logs exist under E:/eldmoor/logs/behavior/{eldmoor,stepping}. Their relay decisions are all writing kinds (memory, chapter, persona); no game Mind entries were logged for members.
  - **stepping:**
    - qwen2.5:14b: 758 turns, 9% empty, 7% failed, p50/p90 28/76 s, $0.
    - Claude Haiku (Nevith): 28 turns, 0% empty, p50 21 s, $0.004/turn.
    - Claude Sonnet (Brenara): 14 turns, 0% empty, p50 68 s, $0.042/turn.
    - Both deaths were qwen members.
  - **Pitfall:** Claude turn tokensIn is huge (about 3.3M per Haiku turn), probably cumulative or cache-read counts from the Agent SDK. Do not compare tokens across providers until that is checked.
  - **Pitfall:** do not run behavior-report with --dir on E:/eldmoor/logs. It writes report.md there. Copy the logs to the scratchpad first.

Related: [[behavior-logs]], [[mixed-minds]].
