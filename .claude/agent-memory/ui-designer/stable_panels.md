---
name: stable-panels
description: How panels update in place (#145) - patch/morph, keys, held(), keepView, the uismoke stub DOM and the shared ui/app.js tick
metadata:
  type: project
---

Every timed panel builds its content into a detached node and calls `patch(target, build)` from `src/ui/stable.js`. Never `replaceChildren` a panel on a tick.

- **Morph rules:** nodes are reused by `data-k` (set it on rows: `keyOf(obj)` for sim entry objects, `'h'+id` for heroes, `'day'+d` for day separators; `byDay()` sets keys itself). Unkeyed nodes match by position and tag. Attributes are synced, and `onclick`/`onchange` props are copied. An open `<details>` keeps the viewer's open state. A focused or changed form control is kept, and a select is replaced only when its options differ.
- **held(node):** true while the viewer is scrolling (450 ms), pressing (pointerdown, up to 3 s), has a text selection, or has a focused INPUT/TEXTAREA or an unchanged SELECT inside the node. patch then returns false; do not consume the signature, and retry on the next tick.
- **Anchors:** rows inserted above the one being read move the scroller with them. For ranked lists (legends, tops, minds) pass `{anchor:false}`. The Chronicle's prepend uses `keepView`.
- A new hero or tab resets the dossier body (`tb.dataset.who`), so it opens at the top.
- `src/ui/app.js`: `initUI(renderer)`, `uiFast()` (0.3 s) and `uiSlow()` (1 s, which also covers the timeline, legends, DM log and seat, and agents). Both `main.js` and the smoke call these. Do not add per-module `setInterval` renders; put them in uiSlow.
- **Test:** `npm run uismoke` (in CI) uses `scripts/stubdom.mjs`. The stub has real attributes, `data-*` reflection, `<select>`/`Option`, a toy 20 px row layout, `window._setSelection`, and document listeners via `document._ls`. A new panel gets a `holds(...)` check there. If you switch patch back to rebuilding, 13 checks fail.

**Why:** the owner saw scroll bars jump to the top. The hero tab body was a new scroll container every 0.3 s.
