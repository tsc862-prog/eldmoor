---
name: cinema-view
description: #979 cinema view - body.cinema hides .shell by visibility, cam.director hooks in draw.js, director rest scales, what to watch when testing it in a browser
metadata:
  type: project
---

Cinema view (#979): `src/ui/cinema.js` (overlays, key C, enter/leave), `src/render/director.js` (camera). The page is never moved: `.shell` hidden by visibility, `#screen` fixed, `.cinhole` holds its height. New UI that must stay answerable while the world is held belongs inside `#screen` above `.cinema` (z-index 4).

**Why:** the owner's "amaze me" request; the map got 43% of the window in the normal views, and he wants the page back exactly when he leaves.

**How to apply:**
- `.screen canvas{width:100%}` catches any canvas in an overlay: use a more specific rule.
- Eldmoor is 80 tiles wide, so at scale 4 on 3440 the view is 54 tiles and the clamp range is under one view: a far company move there is a pan, not a cut. Test cuts at 1280x800 or with `DIR.SIGHT_FAR` low.
- Browser checks that `import('/src/...')` from an eval: restart the spare vite after any edit, or the eval gets a second module instance (camera reads sc 1, the map centre). See [[scene-map-polish]].
- Setting `S.gameMin` backward in a test crashes `campOne` (negative watch index) and stops the frame loop: only move it forward.
- After a vite restart the first load is slow: poll for the setup page's button, do not sleep a fixed time.
- A zone's fog is a hard tile-edged tint in `render/weather.js`; it shows far more at full window.
- Bash heredocs with quotes in them fail here: write edit scripts with the Write tool. Never `rm -rf`, even scratch shots: use a new folder.
