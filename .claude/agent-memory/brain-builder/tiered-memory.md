---
name: tiered-memory
description: #153 tiered long-term memory - a.tiers shape (landmarks, chapters, pend), sources, relay kind 'chapter', journal_search/overview, migration, words.js cycle fix, test pitfalls
metadata:
  type: project
---

Built 2026-11-01 on branch brain/tiered-memory ("Closes #153"), on top of #155 notebook, #179 reflect, #182 reach.

- **Store:** `a.tiers = {v, seq, marks, chapters, pend, nem, own}` in `src/sim/tiers.js`, only for `a.player || a.fellow`.
  - Landmark sources: the history.js record hook (now a list of observers; fellowship.js and tiers.js both register) and memory.js `remember` k=death/join.
  - Landmark keys dedup by kind + day + first words. Weights: death/boss/fellowship 5, nemesis/own 4, friend/crypt/level/vow 3, elite 2. Cap 30.
  - Chapters come from `spill()`: journal entries past PK.JOURNAL, notebook archive overflow (journal-tagged notes are skipped, the journal spills them), and folded landmarks. 20 lines make a chapter; 24 chapters max, the oldest two merge.
- **Relay kind `chapter`:** prompts.js KINDS/WRITE_KINDS, `{title, text}`, MAX_TOKENS 300, PROMPT_VERSION 6. relay.mjs checkWriting and KIND_TIMEOUT 15 s. brain.js registers the writer through `setChapterWriter`, gated by a.player or (a.fellow and F.ai). `applyChapter` only applies the rewrite when the chapter's stamp is unchanged.
- **Tools:**
  - `journal_search {query?, day?, n?}`: landmark hits weigh 3x, so they beat the chapter that also holds the entry.
  - `journal_read` with no n returns the overview (landmarks, chapter titles, last 10 entries cut to 300 chars). It stays under about 9.8k chars, roughly 2.5k tokens, by its caps.
  - `journal_write {landmark:'yes'}`: 3 a day.
- **Prompts:** agent-player `JOURNAL_ORDERS`, which `withMemoryOrders` also appends to old sessions. `resumeNote(firstTurnOfRun, sess.turns)` is added in agent-player (3 loops) and fellowship.mjs (non-scene turns).
- **Migration:** lazy, in tiersOf. An existing journal becomes chapter 1 with `title:null` and `src:'migrated'`. Entries are marked `ch:1` so that when they spill they merge into chapter 1 rather than pend.
- **Pitfalls:**
  - tiers.js importing notebook.js broke module order (table.js TDZ in staged.js). `words` now lives in the leaf module `src/sim/words.js`, and notebook re-exports it.
  - Python edits of JS containing `\'` or `\n` silently failed their asserts. Use the Edit tool for those.
  - `npm run sim` is unseeded. To compare against main, run a seeded wrapper that sets Math.random before importing scripts/headless.mjs. The summaries were identical.
- **Not measured live:** chapter call latency and cost. A chapter is about 20 items x 200 chars in, 300 tokens out, on the default (memory) tier.

Related: [[agent-memories]], [[in-game-channels]].
