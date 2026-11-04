---
name: setup-title-wide
description: #847 setup and title pages at wide widths, CSS block at end of style.css, professions disclosure, sticky Start bar
metadata:
  type: project
---

From 2200 px the setup page zooms .spage 1.5, five places in one row, Professions in a details (open state kept in st.profsOpen), a sticky .sfinal bar with a one-line summary (.ssum) and Start. The title is a two-column grid (menu left, What's new right, zoom 1.6). Narrow widths unchanged. Screenshot recipe: own vite config with cacheDir in scratchpad, port 5903-5908, Edge headless over ws.
