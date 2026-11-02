---
name: table-step
description: Table step mode and structured rolls (#285) - TABLE.step off/hold/auto, sc.sh hold record, stepNext, beat.roll data, bannerOf().foe object, tableView foe words only
metadata:
  type: project
---

#285 (follow-up to #276/#277): the watcher can pace combat rounds, and the banner reads roll data instead of regexing text.

- `TABLE.step` 'off' (default) | 'hold' | 'auto' (+ `TABLE.stepS` 4 real s). The hold sits in runTurns at the end of a round,
  only when another round will follow (`moreRounds`), only for a paused scene at 1x and never on the instant path
  (finishAll). So headless, 3x/8x, Watch mode and reflex-at-speed never hold, and a hold rolls no dice (the world is skipped).
- Hold record `sc.sh={rd,t,go}`; `nextRound` deletes it. `stepNext()` releases (the banner's Next round button).
  `bannerOf().hold={round,auto,left}` and its line "Round N is done · ...".
- Beats carry `roll:{die,mod,total,vs,hit,crit,dmg,target,down}`; the res text stays for logs and agents.
  A member's strike passes its roll through the transient `sc.rr` (memberStrike sets it, take() moves it onto the beat).
- `bannerOf().foe` is now an object `{id,kind,name,hp,maxhp,target(id),pack}` (was a name string); the watcher sees numbers.
  `tableView().foe` is `{name, looks}` in words only (#188: no numbers to agents).

**Why:** the sim sets round pace, so stepping had to live in the sim; parsing text in the UI broke whenever rollText changed.
**How to apply:** new roll-making paths in tableround.js should attach rollData; UI must not re-derive the foe (use bannerOf).
Related: [[table-rounds]].
