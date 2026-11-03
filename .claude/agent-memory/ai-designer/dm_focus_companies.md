---
name: dm-focus-companies
description: Issue #450 (epic #402 slice 13) rules for DM focus across companies - focuses(), per-company hall jobs (h.company), companies_needs order, reserve for any company, why the Fellowship-only path is byte-identical
metadata:
  type: project
---

DM focus across companies (#450, merged via PR from `ai/dm-focus-companies`, 2026-11-02).

- `dmfocus.js focuses()`: one record per company, followed first, read straight from `S.companies` (no company.js import, keeps
  dmfocus import-free). `focus()` stays the five-slot Fellowship's record so levers/staged/pace/behavior/ui callers are unchanged.
  `ffFor(h,f)`: an ff job without `h.cid` (old saves) belongs to the slot company. The field is `h.cid`, not `h.company`, and the
  last-touched minute lives in `S.dmFocus.last`, not on the company: savecheck's v6 fixture asserts no `"company":` key anywhere and
  deep-compares company records, so both broke it.
- Solo worlds (playcheck) now draw differently on the boards; RNG-reliant fixtures there may need their hero held alive.
- `dm.js`: every ff job gets `h.cid`. The five keep their exact draws (same template pick, same reasons), other companies
  draw only templates their lowest member can take (`T.lvl<=lo`), skip below `K.MIN_LVL`, and an elite hunt needs a walking party of
  2+ (a company without a party could never take it: `fits` needs mem>=2). `fits`: another company's ff job ignores `T.size[0]` (a
  solo takes its own hall job). Boards that are nobody's hall hold at `K.FLOOR` while NO company has a job under way
  (every company idle; "any idle" starved the background whenever a solo loafed). Even so, a solo-only world draws differently:
  townpilotcheck default seed is 2 (passes before and after; per-seed luck since #487).
  **Why:** with only the Fellowship every branch reduces to the old code, so professioncheck/tablecheck/dmcheck hashes and the
  --focus shares stayed identical (verified against main 4ee5a73).
- `companies_needs` order (issue text beats the doc): followed company only when it must choose (own open scene or vote), then any
  pending scene/vote, then hurt members in the field, then longest since `S.dmFocus.last[id]` (touchedAt) (never = longest), then size (solo first), then
  id. Shown in dm_status only when a non-Fellowship company rides, so a Fellowship-only dm_status reads as before.
- `fellowship_change` = one sig per company `id:sig` joined with `|` (single company: its plain sig). `tally` stamps `S.dmFocus.last[id]`
  and `S.dmFocus.by[id]`; share() counts an action touching any company.
- Lever reserve: kept for a pull touching any company (`pullTouchesAny`); fairness/starvation is #451, not here.
- Not done here (other owners/slices): staged.js per-company reserve and level bound (#440's file), pace.js hallBrief for a solo's
  hall, behavior.js digest still uses focus().

**How to apply:** for #451 fairness, hook into `touchedAt(C)`/`S.dmFocus.by` and `companiesNeeds()`; keep the slot-company branch
drawing exactly as before or the seeded hashes move. Test pattern: dmcheck children `--companies`, `--needs`, `--focus-companies`
(pick free heroes that are not hidden or in the Crypt, or "field" checks silently fail). See [[company-model]], [[emergent-parties]].

Fixture lesson (campcheck, 2026-11-03): `SIM.leaveParty` does not exist, so `SIM.leaveParty ? ... : null` silently kept a
"company" fixture hero in its scripted party; its leader's job rolled for it and #485's per-company Table opened a check scene
that paused the world. Import `leaveParty` from party.js and strip the hero from active adventures' `mem`. Open gap (not fixed):
`seekParty` excludes only `a.fellow`, so scripted musters can still draft agent heroes of other companies.
