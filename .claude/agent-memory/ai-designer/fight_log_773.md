---
name: fight-log-773
description: actlog.js hurt entries use who=attacker, fight results won/over/fled rules (#773)
metadata:
  type: project
---
Hurt entries: who = attacker, target = victim hero (like every recorder: who is the actor). Fight result: died, fled only after actFlee, won on a kill or shared kill xp (c.xp from actNote 'xp' inside the fight gap), else 'over'. **Why:** companions' kills never fire actKill, so wins read FLED. **How to apply:** new readers treat who as actor; log is unsaved so hashes unchanged.
