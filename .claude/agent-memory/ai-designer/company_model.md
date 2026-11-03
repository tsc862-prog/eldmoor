---
name: company-model
description: #438 (epic #402 slice 1) company data model in sim/company.js - shims, ids, save v7, why the fellowship hash stays put
metadata:
  type: project
---

Slice 1 of epic #402 (issue #438, branch ai/company-model): `src/sim/company.js` holds companies; `S.companies`,
`S.companySeq`, `S.followId`, `S.companiesPast`; `a.company`, `p.company`. SAVE_VERSION 7, MIGRATIONS[6].

Rules chosen and why:
- **Shims are accessors, not fields.** `S.fellowship` is a non-enumerable accessor on S (the company that still has
  `slots`); `a.fellow`/`a.fellowRole` (linkHero) and `p.fellow` (linkParty) are non-enumerable getters derived from the
  company, so ~150 readers keep working and saves never carry them. Assigning them throws (strict mode, getter only):
  that is deliberate, it flags any stray writer. `restore()` calls `relinkCompanies()` to reinstall them.
- **Only the five-slot company stands behind S.fellowship.** Solos (every agent hero is in exactly one company; markPlayer
  founds/ends them) must not pick up Fellowship behaviour before their own slices land.
- **Ids from S.companySeq, never S.uid.** Taking uids would shift mob/party ids in agent worlds. The Fellowship still
  consumes one `++S.uid` at founding, stored as `C.seed` (its name hash seed), so the seeded hashes do not move.
- `a.fellowFrom` lives as `C.from[id]`; members still relodge to the hall (behaviour unchanged until slice 2+).
- Fellowship `C.ids` stays in slot order (Table "everyone at once" resolves in that order).

Hash proof: `node scripts/professioncheck.mjs --hash` fellowship=false 2890548967, fellowship=true 1733832012, equal on
main 048bc2b and the branch. A real v6 save made by main's code (git archive into scratchpad) restores and runs 20 s
identically in old and new code.

Testing pitfall: two `restore()`s of the same save in one process drift apart (module-level accumulators and caches are
not saved), and `rnd()` captures Math.random at module load, so seed with `seedRng()` and compare runs in child
processes (savecheck `--fixture`).

**How to apply:** later #402 slices delete the shims (slice 12) and give solos their own logs, tables and DM focus;
keep new per-company state on the company object, iterate companies by id and members by `C.ids`.
