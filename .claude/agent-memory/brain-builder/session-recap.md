---
name: session-recap
description: #808 recap across a roll: why a turn grows, roll vs recap vs written recap vs /compact numbers, what a live run still has to show
metadata:
  type: project
---

`scripts/session-recap.mjs`, on by default (SESSION_RECAP=0 off), hero and company Claude runners. The DM has none (it has notes and read_dm_log). Brief.heard lines plus closing narrations, ring on sess.recap, first prompt after a roll.

**Growth, from ctx in turns.jsonl (1,069 Haiku hero turns):** p50 about 3k, mean 3.4-4.0k, never 10k (that was cache writes before ctx was logged; cacheWrite mean is 7k). OLS of ctx delta on tool counts, R2 .80-.84: turn prompt 750-1050, wait about 400 each (2-2.5 a turn; a wait at the table carries the whole tableView, about 1,400 chars), other tools 180-240 each, output-linked the rest. Spend: cache read 67%, cache write 21%, output 10%.

**Rolls:** 0.3-0.6 per member per game day, every 9-12 ctx turns (28.7 run turns a roll in fellowship-runs.jsonl, forced scenes counted). Rolled turn 12.1 calls vs 5.7, $0.0062 vs $0.0038; repeat-line refusals 0.087 vs 0.008 a turn (4 in 46: thin but the only hard sign of forgetting).

**Comparison, real CLI, mock API with a longest-common-prefix cache model, $ a turn over 40 turns:** roll .004338 (rolled turn 12 calls) or .003895 (5 calls); recap .004393 / .003917; written recap .004434; /compact 2k summary .004123 (no re-orientation) or .004686 (with). So recap +0.6-1.3%, written +2.2%, compact +6-8% like for like. Compact only wins if it removes the re-orientation and the recap does not.

**Why:** owner rule #799. A deterministic recap needs no slot, cannot delay a scene and is testable offline. **How to apply:** a live run should compare repeat refusals and calls on turns flagged session-recap against session-rolled alone. Untried lever: with a recap, drop "start with journal_read" on a roll (rolled turn back toward 5 calls, about -10%), but landmarks then wait until the hero reads them; owner's story rule first. Shrinking growth is not a cost lever: the roll is a sawtooth.

**Pitfalls:** this cannot be judged for summary quality without paid calls. Bash heredocs broke on this file set: use Write for edit scripts. The agent's memory index MEMORY.md is locally modified in the owner's checkout, so a PR must not touch it (the launcher's pull would refuse); add its line there.

See [[session-size]], [[lazy-tools]], [[cost-report]].
