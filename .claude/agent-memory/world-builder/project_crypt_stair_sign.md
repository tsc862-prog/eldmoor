---
name: crypt-stair-sign
description: #448 stair sign, captain warning and green-blade lore read; data in spec.js, no level gate
metadata:
  type: project
---

Crypt landmarks carry `sign` and `captain` text (CRYPT_SIGN, CRYPT_CAPTAIN in spec.js, passed through gen.js). lore.js `readSign` on first sight of the stair marks it dangerous to heroes below the region band; `captainWarning` is used by player.js talk when the person is a captain. No RNG, map hashes unchanged.

**Why:** owner decision on epic #402, the game never refuses a descent for level; danger is legible in the world.
**How to apply:** new dungeons add `sign`/`captain` to their spec entry. The code gate is removed in #449.
