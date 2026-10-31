---
name: traits-roster-decisions
description: The eight personality traits (issue #3), their modifier keys, class leanings, and how balance was gated; read before adding or tuning traits
metadata:
  type: project
---

Eight traits live in `src/data/traits.js` (Reckless, Cautious, Greedy, Loyal, Loner, Vengeful, Pious, Boastful), rolled 1-2 per hero in `makeHero` with class leanings; exclusive pairs Reckless/Cautious and Loyal/Loner. Modifier keys: retreat, flee, greed, thrift, bold, loyal, social, mercy (mercy was added beyond the issue's suggested set so Pious has a real Priest hook: heal threshold 55% * mercy).

**Why:** Issue #3 wanted heroes to feel like individuals while keeping `npm run sim -- 120` deaths within 15% of baseline. The decision logic reading `tm(a,key)` sits in heroes.js/pvp.js/party.js (ai-designer's files) as single-token substitutions so parallel agents (weather, chatter) could merge cleanly.

**How to apply:** New traits go in TRAITS as data only; wire new keys as `*tm(a,'key')` multipliers on existing constants rather than new branches. 120-minute death totals swing roughly 90-120 run to run, so measure at least 4 runs per side before claiming a balance change. The assist roll in pvp.js was moved from per-duelist to per-helper so `loyal` applies to the helper; this slightly raises assist frequency.
