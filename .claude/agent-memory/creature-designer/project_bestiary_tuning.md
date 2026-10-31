---
name: bestiary-tuning
description: Non-obvious tuning decisions behind Eldmoor's mob tables (Hoarfell bands, territorial aggro, price ladder), with the sim numbers that justified them
metadata:
  type: project
---

Hoarfell (zone 3, heroes 16+) was populated 2026-10-31 with Rimehound [15,18], Tundra Shaghorn [16,19], Tarn Wight [18,21]; counts 9/8/8.

**Why these bands:** balance-tester analytics showed a 1v1 at own-zone level costs a weak-gear L16 caster 40-60% HP (slow, retreat-cycling, but safe) and an L20 26-38% vs a lv21 mob. Adds (two mobs) are lethal at L16-18, but the fight code makes adds rare (fighting heroes are not aggro-eligible; `findMob` skips mobs with a target). Zero L15+ heroes died to Hoarfell mobs in 5x 240-min runs. Tarn Wight was deliberately NOT shifted down to [17,20].

**Mob aggro is territorial** (`updMob` scan skips heroes whose `zoneAt(x,y)` differs from the mob's zone). Added because Hoarfell mobs wandering 2 tiles south of the y 9-15 border were killing L6-7 heroes travelling Highgate->Mirefen (3-9 deaths per 240-min run). After the fix: 0-1 per run, the remainder being travel lines that clip Hoarfell itself (routing, owned by ai-designer/world-builder).

**Price ladder:** base price climbs with zone: Thornvale 4-7, Mirefen 9-14, Grave Dust 18, Cinderpass 22-26, Hoarfell 30-40. Keep new goods on this ladder.

**Headless caveat:** `npm run sim -- 10` never reaches level 16; verifying high-zone content needs 120-240 minute runs. The stock harness lists only the last 8 deaths; the balance-tester keeps a tallying variant (`h2.mjs`) in its scratchpad and baselines in `.claude/agent-memory/balance-tester/project_baselines.md`.

**How to apply:** when adding a zone's mobs, stagger three bands overlapping the zone floor by one level, ask the balance-tester for the 1v1 / add table, and check border aggro against lower-zone travel routes.
