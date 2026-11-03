---
name: company-runners
description: #460 company runner kind, /play/health company fields, seat restarts (adopt), per-company digest/report, and what of the shim deletion was left
metadata:
  type: project
---

Company runners (#460, epic #402 slice 23), landed 2026-11-03.

- Kind `company` in `scripts/runners.mjs`: key `company:<id>`, request `{kind:'company', company}` or `{hero}` (a member),
  args `scripts/fellowship.mjs --company <id>`, `multi: true` (like `fellowship`: turn cap "each", claude-concurrency, no
  per-runner turn-cap stop). Seats: one per living member (`seatsOf`); the Fellowship kind still counts 5.
  `kind:'fellowship'` stays as the five-place alias (Start all five, rungate, active.json).
- `/play/health heroes[]`: built by `seatInfo(a)` in `src/sim/player-host.js` (page hello + play-headless): fellow/role/lead/
  table/due as before for Fellowship members; `company, companyName, size` for every seat; `lead/table/due` also for a
  company of 2+. relay `cleanHeroes` passes them.
- `fellowship.mjs --company <id|name>`: name matches companyName or a member name. Non-Fellowship members get
  `companyPrompt(st,{name,size})` (Fellowship text with the first line swapped; solo = short own text). Members whose
  health `company` changes are ended ('left the company'). Log `logs/company-<id>.log`; run record has `company`.
- Seat restarts: `adopt()` every ADOPT_MS 2 s: a member a company runner held (`r.held`, filled by view()) now in another
  company and released -> hero runner with the company runner's mind; a hero runner that ended with its hero dead
  (`heirWatch`) -> hero runner for `succeeds` heir within HEIR_WAIT_MS 10 min. `handed` set = once per hero.
- Behaviour digest: `companies:[{id,name,size,minds,deaths,fellowship?,ended?}]`, members[].company, deaths[].company
  (from `coSeen`, the last-seen company map, since companyTick deletes a.company on death). Report `## Companies`
  (`companySection` in behavior-report.mjs, returns `companies` data).
- UI (out-of-area, minimal): `ui/runners.js` startRunner/stopRunner take kind 'company' (hero arg = company id),
  startCompany starts one company runner when 2+ members and none has a runner; `ui/setup.js` afterBoot starts company
  runners from planRunners (no more per-hero expansion); setupsmoke text "one runner for the company of".

**Not done (deliberately):** deleting `fellowship.js`, `S.fellowship`, `a.fellow`, `fellows()`. ~300 readers across ~45
files in five areas (incl. DM files under parallel work), and fellowship.js still owns real slot logic (recruit, muster,
enrichment, record hook, chronicle filter). Needs the slot model moved into company.js first, as its own slice.
Only dead uses removed here (mindsOf in player-bridge and behavior.js).

**How to apply:** for multi-hero runner rules use `multiRunner(r)`, not `kind === 'fellowship'`.
