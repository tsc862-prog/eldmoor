---
name: ultrawide-dock
description: #546 dock layout from 2560 px (owner watches only at 3440x1440): map ~70%, one dock with Company/Hero/Story/Chat tabs, --uiz zoom, story-lead default hero, mind dot on frames, docked outdoor banner
metadata:
  type: project
---

The owner watches ONLY at 3440x1440 (2026-11-03); phone width only needs to not break.

- `src/ui/layout.js`: `DOCK=2560`, `cols==='dock'` when a company exists. #side gets `#dockTabs` (Company, Hero, Story, Chat; `showDock(t)`,
  remembered `eldmoor.dock`); sections move into #side and the inactive ones get class `doff` (not `hidden`: their own modules set
  hidden). Unknown sections in the dock fall under Story. Undock re-sorts the side by data-o. 2200-2559 keeps the 3-column layout.
- UI scale: `--uiz` 1.2 at 2560, 1.35 at 3200+, applied as CSS `zoom` on header, .frames, .bar, #side, #colL, the banner and
  `.sheetov>*`; never on the map canvas. Zoomed elements scale their own px insets, so docked banner `bottom` is
  `calc(var(--scbar)/var(--uiz))`. getBoundingClientRect returns visual px (Chrome 128+).
- Default hero: `startHero()` in controls.js (main.js calls it) = saved pick if it rides with the followed company, else
  `storyLead(C)` (companyview.js). `syncFollow` selects the new company's leader when the follow changes. Clicks on a hero (map, name,
  frame) open the Hero tab; keys 1-9 do not.
- Background hero in the dock: short card + "Full sheet" (`briefCard` in panels.js, set per hero id).
- Frames: no runner control or oath chip; `.pfdot` (agent / autopilot / reflex) with the runner state line in its title. Start/Stop
  lives in Company > Members and minds (and Agents).
- Chat: one `#chatTabs` row holds `#chatFilter` chips + "DM agent" toggle (+ "◀ Chat" while in the DM view); legend is a tooltip.
- Outdoor scene: `.screen.scopen .tbanner:not(.tlive)` docks; `banInset()` in sceneview gives `cut.right`, draw.js shifts the camera.
- Intent icons button moves onto the View bar in dock mode (uismoke bar cap 11 only there).
- Browser button counts: closed `<details>` content still reports non-zero rects in Chrome; use the toggle state, not rects.

**Why:** owner found the 3-column page cluttered at 3440 (67 buttons, tiny text, random background hero in the dossier).
**How to apply:** new panels must declare a dock tab (DOCK_TABS) or they land in Story. Screens: scratchpad g546/shot.mjs. See [[watcher-ia]], [[company-frames]], [[scene-map-polish]].
