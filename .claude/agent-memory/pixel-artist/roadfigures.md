---
name: road-figures
description: #896 road guards and travellers use the LPC townsfolk sheets via sheetFigure in traffic.js; shot-staging gotcha
metadata:
  type: project
---
- traffic.js `sheetFigure` draws `sprite:npc-<role>-<race>` through `sheetFrame` with a probe object; a walker has no people, so it takes `racesOf(fac)[n % len]`. Roles without a sheet (stranger) fall back to the procedural figure; tinker maps to peddler.
- Shot gotcha: editing a src file while your vite runs makes the page re-import draw.js as ?t=, so CDP `setZoom` hits another instance and the shot stays at zoom 1. Restart vite after any edit. Need `S.table=null` to leave a rescue scene cut.
