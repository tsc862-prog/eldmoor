---
name: hire-tool
description: #634 hire/dismiss tools in sim/hire.js - hires are real scripted heroes, wanderers not townsfolk, voters skip hires, inSlots true for Fellowship hires
metadata:
  type: project
---

hire {npc, days} makes a scripted hero (a.hire terms, a.companion = company id) at the company's lowest level; the person is stashed in S.hireAway and restored (hmem) when it ends. Sellsword/drover are WANDER_ROLES, placed only by create_npc, not resident townsfolk.

**Why:** the issue wanted hires outside the slots and the start gate; fall() skips the recruit for a.hire; council voters() skips hires (companions of invites still vote).

**How to apply:** the Fellowship may hire (slot party joined in hireTick) but inSlots(hire) is true there; use slotKeyOf to tell slots apart. DM offer = npc_offer kind hire (p.hireOffer). Test persons via pull('create_npc') with S.gameMin bumps (cooldown 60). toolmap.mjs was not on main yet, so no HERO_GROUPS entry.
