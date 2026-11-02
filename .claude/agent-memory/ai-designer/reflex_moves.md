---
name: reflex-moves
description: How agent-played heroes on reflex use class moves (#347 heals only, reflex spec pick) and why Antler Ward has its own widened rally trigger (#348)
metadata:
  type: project
---

**Reflex heals (#347).** `fightMoves` used to return null for any `a.player`, and every Fellowship member is
agent-played, so members on reflex never used class moves in the field and never picked a level-10 path
(`ensureSpec` skips `a.player`), so a reflex Priest could never get Mending Touch. The Table healer reflex also
returned the plain `heal` before asking the move policy.

Rule now: when `reflexMay(a)` (runner gone + owner resumed, or no host as in `npm run sim`), `reflexHeal` in
`sim/moves.js` takes the scripted path at L10 and uses **heal-kind moves only** through `pickMove(...,isHealMove)`
and `useMove` (cooldowns, action log, `S.moveStats`). Strikes, control and wards stay the agent's. A live runner
keeps everything. At the Table, `reflexFor` returns `tableHealMove(a,fellows())||'heal'`.

**Why heals only:** the issue asked for heals; giving reflex members their full kit would shift Fellowship balance
more and take decisions from agents. A follow-up could open the full kit on reflex.

**Not covered:** the dungeon crawl (`crawl.js`) heal stays the abstract 25% room heal; members are `hidden` there so
`useMove` would refuse anyway, and crawl offers no abilities to agents either.

**Antler Ward (#348).** It shared the Skald's `rally` trigger (2 hunted friends or one < 50%, monsters only), which a
mostly solo or duelling Springwarden never met: 0 of 1225 sampled fight moments in a seeded 60-min probe. Now a
path's rally move (`M.spec`) also fires for one friend in reach (self too) below 70%, unwarded, hunted by a monster or
by the foe in hand (duels count). 0 -> 15 uses in that seed. Rallying Verse unchanged.

**How to apply:** prove "unchanged without X" with a seeded hash where X is removed from its table at runtime
(e.g. splice `springwarden` from `CLASS_SPECS.Wildspeaker`), not by hoping the seed lacks it. See [[check-fixtures]],
[[fellowship-always-agents]].

**Camp fixture (2026-11-02).** After this change campcheck "one-hour rest ends on time" failed: no game bug (camp members never reach fightMoves). The seeded watch roll became an ambush at the end of that hour, which breaks camp with no "Camp is broken" event. Fix was to hold `CAMP.AMBUSH_P` in that fixture. Before blaming new behaviour, find the real break reason (`breakCamp` why).

**Heal order below 35% (#387).** A reflex Table healer, lowest member below 35%: class heal move (if ready and fits),
then a potion, then the plain heal; 35-60% stays move-or-plain-heal; non-healers still drink first. Why: the potion
used to come first and wasted a ready Mending Touch/Chorus. A Priest at L12 picks Chorus for one badly hurt friend,
so movecheck asserts "any heal-kind move" and cools all of them for the potion case. Seeded hashes did not move.
