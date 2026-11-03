---
name: dm-fairness
description: #451 DM fairness between companies - fairness()/fairRefusal in dmfocus.js, staged scenes per company, dmcheck child modes and pitfalls
metadata:
  type: project
---

#451 (epic #402 slice 14). `dmfocus.js`: `FOCUS.STARVE_MIN` 360, `FOCUS.FAIR_MIN` 240; `fairness()` -> `{spread, rows[{cid,name,since,field}], starved[]}` (since = minutes since `S.dmFocus.last[cid]`, never touched counts from minute 0; starved = in the field and since >= 360; spread null below two companies); `fairRefusal(name,p,z,fs)` -> "kept for <company> first" or null. `levers.js` one added line after the reserve refusal: only when just the reserve is left (`D.n >= perDay - reserveOf`), a pull touching only recently served (<240 min), non-followed companies gives way while another is starved. fs[0] is the followed company and is never refused. One company: `fs.length<2` -> null, seeded hashes unchanged.

`staged.js`: `STAGE.PER_DAY` is a getter, 2 + max(1, companies). `RESERVE` is per company: a world scene is refused at `nw >= PER_DAY - RESERVE*companies`; a company scene is refused when `n + (other companies with no scene today) >= PER_DAY`. `today().c[cid]` counts a company's scenes. `whereOf` takes `company:<id>` or a non-Fellowship company's name (leader first, in the field), and any company member by name. `rec.company` is set only for non-five companies (five records unchanged). Party level (`P`), pile-on (`PILE_HP`), tick/meet/reinforce members all use that company's members (`memOfCo`, `recMem`). The early PILE_HP check stays for single-company worlds (refusal order unchanged); with several companies the check runs after the target is known.

**Why:** the owner wants no company starved and a solo never meeting an elite staged for the five next door.

**How to apply / pitfalls:**
- The scripted DM does NOT keep every company under 360 min: over 150 game hours three companies were starved ~7% of company-hours (worst gap 744 min). The dmcheck `--starve` case therefore asserts no gap over a game day, not none over 360 min. Making the scripted DM serve a starved field company is a `dm.js` change (ai-designer) if the owner wants it.
- dmcheck children `--fairness` and `--starve` must sit near `addCompanies()` (top-level code before the main checks runs the child and exits); the asserts are in a block before the #447 solo block.
- `S.levers.day=null` crashes `today()`; reset to `{d:-1,n:{},rz:{},nf:{}}`.
- A staged elite preview with `cast.level` over avg+3 refuses ("far above the party (average level N; at most N+2)").
- `npm run sim` is not seeded (Math.random), so compare seeded hashes (`professioncheck/tablecheck/dmcheck --hash`) against a `git archive origin/main` copy with a node_modules junction, remove the junction with `rmdir`.
