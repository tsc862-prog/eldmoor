---
name: apart-companycheck
description: #459 companycheck part two (scripts/companycheck-apart.mjs): the apart world end to end, section layout, fixture tricks, the two bugs it found (green-warning punctuation, heir opening settled unseen)
metadata:
  type: project
---

`npm run companycheck` = `companycheck.mjs` (the verbs, #442-#445) then `companycheck-apart.mjs` (#459, the apart world
end to end, ~6 s). Each section calls `apart()`: a fresh `init({setup})` of `pairs-and-solo` (Concord, Highgate) plus a
Warband solo at Grimhold, all on a local mind (six seats only validate when every mind is local, SEATS.LOCAL).
Builds on [[emergent-parties]], [[setup-v2]], [[table-per-company]], [[arrival-session-zero]].

Fixture rules learned:
- `setRunnerLinks`, `setDmSeat`, `TABLE.mode/speed` are module state that `init()` does NOT reset: `apart()` resets them.
- `init({setup})` plans session-zero openings (`S.opening`); delete it unless the section tests openings, or a hosted
  section opens them first.
- Only two cities exist (Highgate fac 0, Grimhold fac 1): "two solos in two towns" means one per faction.
- Green companies (lvl < `K.MIN_LVL` 4) get no hall job by design (#450); season to 6 before testing hall boards.
- The camp visitor picks a nearby enemy *hero* 40% of the time (a duel, then a table `ambush` named after the hero):
  move other-faction heroes away while forcing `CAMP.AMBUSH_P = 1`.
- Offers lapse after `PARTY.OFFER_MIN` (60 game min): accept before any `S.gameMin +=` courier wait.
- The propose tool's free text is `details`, not `text`.
- Section I hashes `init({fellowship:false})` + run(240) before and after all sections (init leaves nothing behind);
  `--hash` prints it, `COMPANY_BASELINE_HASH` compares.

Bugs it found (fixed minimally, PR for #459):
- council.js: the #449 green warning was glued to an unpunctuated kind text ("...Crypt Those who went below..."); now a
  period is added when the base text has none. Text only, hashes unchanged.
- arrival.js: a solo's heir (new hero id) had its opening settled unseen on the next tick, before any runner could hold
  it. Now `heirReady`: the heir's opening waits until `agentLive(heir)` or `ARRIVE.HEIR_WAIT` (60 game min). Hosted
  worlds only, so seeded hashes unchanged. Why: the heir's agent should play its own session zero.

Since #518 (S.tables) several scenes are open at once: read a company's scene with `T.sceneFor(C)` / a hero's with
`sceneOf(a)`, never `S.table`; a merge opens both companies' decision scenes at once (no tableQ). Section G covers the
engaged hold: two unfollowed rescues open together, members and foes `held`, each resolves on its own. A pair's rescue
seats both members, so answer for all of them or the table waits for the live silent one.
