---
name: others-none
description: "#780: others 'none' world setting and summon_hero lever; why guilds skip companies, GOODS floor, heir rule, what the long runs showed"
metadata:
  type: project
---

`S.setup.others==='none'` (`noOthers()` in state.js) is a world with no roster; 'full' writes nothing, so seeded hashes do not move. `summon_hero` lives in sim/summon.js, installed from index like bestow.

**Why these rules:**
- Guild founding skips company heroes and companions only in a none world: a company of five is linked by its party, so found() would raise a banner around it at once. Summoned heroes still found guilds (seen: 2 guilds in a 760-hour run), so the DM can rebuild a world.
- GOODS floor is .5/.035, the supply where price() is exactly base. A price_shock in force is skipped, or the floor would undo an "up" shock the same step.
- The death hook leaves an heir for the last of a company even with no host or runner, because no recruit comes behind them; an arrival also opens at once when nobody is left. Otherwise a none world can empty.
- a.summoned leaves no recruit in any world: the DM's cap of 8 and the roster would both drift otherwise.
- Vote text in unitDraft says "nobody else will go" in a none world; "the faction musters" read false.

**How to apply:** a new system that assumes a roster must survive S.agents of length 0 and a faction with no heroes (`init({others:'none',fellowship:false})` is the empty case). Measured 2026-11-03: 760-hour together runs L18-20, about 40 Crypt runs, 0-3 deaths, Kragmaw killed 5 times by the five alone; no NaN, no crash.
Fixture trap: an init({setup}) world with links set queues session zero first; clear S.opening.queue before testing an arrival. Slot deaths are noticed by slotsTick, so step before asserting.
