---
name: rebalance-issue18
description: Tuned hardcore rebalance values (PvP odds, yield, grudges, raid gate/retreat, crypt wipe) and what moved the numbers
metadata:
  type: project
---

Final values (PR for issue #18): chance duel `.04*bold*bold`, level gap 2; duel yield below `.3*flee` HP at rate 1.5/s (outnumbered stays 50%); nemesis spotCd 45; guild assist `.2*loyal`; guild-wide grudge only if victim lvl >= `GUILD_GRUDGE_LVL`=12 (party mates always); raid needs lvl 14+, 5+ heroes or 4 with avg gear >= 9; raiders retreat below `RAID_FLEE`=.15 maxHp (rate 2/s); failed raid cools down 240s; crypt wipe death chance .55; Kragmaw lvl 20 (label only).

**Why:** Biggest single wins were the chance-duel odds/gap (PvP 70% -> ~30% of deaths) and the raid retreat (raid deaths 13/run -> ~2). Merging item stats (PR #54) made everyone sturdier, so wipe odds and flee/duel numbers were backed off afterwards to keep >=25 deaths/h.

**How to apply:** Tally script lives outside the repo (scratchpad tally.mjs + run.mjs; polls S.agents for dead, parses chronicle for raids/crypt). Noise is huge (deaths 24-66 per 2h run), judge on 6-8 run means. Late game (240 min) PvP among lvl 11+ vets still reaches 50-75%: a candidate for a future vet-gap or rivalry cap. Thornvale L1-3 mob aggro was left untouched (mob deaths ~14/run were within target).
