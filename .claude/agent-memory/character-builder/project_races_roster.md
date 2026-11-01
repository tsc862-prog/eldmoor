---
name: races-roster-decisions
description: The six peoples (issue #35): names, homes, how assignRace/homeOf are wired, the a.home vs a.town collision, and the import-cycle gotcha; read before adding a people or a home town
metadata:
  type: project
---

Six peoples in `src/data/races.js` (branch `characters/races`, scaling phase 4): Concord = Hallowan (Highgate), Carrow (Cairnmoot), Skerrin (Saltmarsh Reach); Warband = Ashfolk (Grimhold), Mirekin (Murkstead), Thornhide (Thornteeth). Only Highgate and Grimhold exist on the map; `homeOf(a)` falls back to the faction's first town, so the other four homes are reserved names in LORE.md until world-builder adds towns with `race:'<id>'` in the spec.

**Why:** Issue #35 wanted recruits born in and returning to a race's home town so that new towns per faction slot in without code changes. `assignRace(a, S.agents)` weights by 1/(1+living count) times a class lean so the roster stays even and Carrows skew Hunter etc.; the user's decided design was cosmetic plus a lookup change, no stat differences per race.

**How to apply:** `a.home` is already the backstory hamlet string (goals.js sets it after makeHero's inserts), so the town is `a.town` (name) and `homeOf(a)` resolves it against `CITY`; do not store the town object on the hero. `races.js` must not import `sim/state.js`: state -> factions -> races -> state is a cycle that throws a TDZ error in factions' `FAC.skin` derivation; pass the roster in instead. Sprite: `H` is now class helm only, `R` (4 pixels at the helm rim and ears) is race hair; cache key includes race, skin and hair. Still on `CITY[a.fac]` after this PR: encounters.js pilgrim lines, goals.js `{city}` origin text and pilgrim gate, panels.js `doing(a)`; switch them to `homeOf(a)` when a second town per faction lands. 60-min deaths were 45/39 vs 37/50 on main (noise).
