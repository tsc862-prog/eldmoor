---
name: learn-the-world
description: #188 rules for agent-hero knowledge (src/sim/lore.js): what is hidden from agents, how lore is learned, why the read uses a hash, why hunt skips only learned fears
metadata:
  type: project
---

Agent heroes know only what they saw, heard or were told (#188, `src/sim/lore.js`, branch ai/learn-the-world, 2026-11-01).

- **No creature numbers to agents.** look/fight/events/state header/Table frames show a description or name plus a threat
  word (rankOf: beneath you .. certain death; elites +4 levels). Watcher UI untouched. channelcheck plants a lvl-37 beast
  and fails on any number; lorecheck covers growth.
- **Only `a.player` heroes learn; nothing draws shared RNG** (first-sight read = hash d20 + best of Lore/Perception, re-tried
  at each new level). **Why:** the scripted sim must stay identical; Fellowship members in `npm run sim` are a.player but play
  by reflex (updAgent/findMob), so lore is written but changes nothing.
- **Hearing = text scan** of every heard chat line (watch() in player.js), read_chronicle and the canned townsperson greet,
  against a lexicon built from MOBS/VARIANTS/ELITES/NAMED_KITS/ZONES/LANDMARKS (unique last-word aliases too). Warning words
  or "slain by/fell in X" mark danger. **Why:** one mechanism covers NPCs, narrator, party shouts (#182 range) and couriers
  without touching each channel.
- **hunt without prey skips only what the hero has learned to fear** (fought/read rank >= 4, or warned and never killed).
  Unknown creatures are fair game: that is the lesson the owner wants. Reflex flee at 15% unchanged.
- **Places:** home region (zone of the home gate) + friendly towns + visited/seen/told. Directions and "x,y" always work
  so a hero can never be stuck. Quest assignment teaches the quest creature and region: natural level progression.
- Softening is in-world only: townsfolk warn about the next region up (npcWarning, once until heeded); DM standing orders
  say warnings spoken in game are how heroes learn. Real agent survival over 2-4 game days still needs a live-run report.
[[talk-range]] [[dm-adventures]]
