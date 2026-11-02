---
name: sheet-last-fight
description: Fellowship sheet "Last fight" row (#241): cell is a .hn.shfight button, opens that member's Combat tab
metadata:
  type: project
---

sheet.js row `fight` uses fightSummary(a) (stub override globalThis.__actionLog.fightSummary). The button carries data-hid so panels.js follows the member; sheet.js's click handler also calls setTab('combat'). The sheet itself scrolls sideways inside its frame on phones (by design).
