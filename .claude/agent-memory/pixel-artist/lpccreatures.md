---
name: LPC creatures
description: #831 creature sheets cut from OGA LPC packs by lpc-creatures.mjs; what fit, what did not, how to stage the shot
metadata:
  type: project
---
- `scripts/art/lpc-creatures.mjs` + `.json` cut mob sheets (index-only `sprite:mob-<key>`, manifest sizes must be updated, 64 tier = 2x). Packs in `assets/packs/oga-lpc-<set>/` (wolf, boar, spider, golem, skeleton, frogman fetched by curl from OGA, zips unpacked with python -I into new folders).
- Fit: wolf/rimehound, boar/mudboar, spider/lurker, golem, frogman as Bogling; skeleton as Wight is marginal. Did not fit: LPC bull (a spotted cow, tint keeps spots), Reptile pack (modular overlays, no drake), lpc-monsters (bat, slime, worm). Animals pack is CC-BY only: out by the licence rule.
- Quadrupeds end-on are taller than a hero, so `vertical:'side'` uses the side view for up/down.
- Staging: scratch vite on 5904-5910 (5902/5903 were taken by other agents), CDP script spawns Chrome from Node, `import('/src/render/draw.js').centerOn(...)` gives the follow-like zoom (setZoom(1) is the whole map); spawnMob then set x,y,moving,hidden.
- **Why:** owner liked the LPC heroes; creatures were the weakest thing. **How to apply:** next creature art (drake, shaghorn) should go through the same json, or #788.
