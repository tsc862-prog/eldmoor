---
name: action-log
description: #248 action log (src/sim/actlog.js) design: non-enumerable per-hero ring, fight settling, what is not recorded and why
metadata:
  type: project
---

Recording-only log: `a._al` is non-enumerable so saves skip it (rebuilds in play). Fights settle after 30 game min quiet (a pack = one fight). Hooks are one-liners; no RNG, no scans. No miss/dodge/block/passive events exist in combat code, so none recorded. Proof pattern: `node scripts/actcheck.mjs --hash` must equal `wakecheck --hash` on main.

**Why:** owner wanted a watcher tab (ui-designer built it) without touching outcomes or save size.
**How to apply:** new damage/heal sources should call actHurt/actHit/actHeal where hp changes; keep `_al` out of saves.
