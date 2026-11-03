---
name: scene-props
description: #592 scene props as sim data: sc.props shape, where derived, examine/search/give_item hooks, uismoke pitfalls
metadata:
  type: project
---

`sc.props=[{id,name,item?,gone?}]`. Word list moved to `src/data/props.js` (PROP_KINDS, same order as the old render ITEMS, plus `look` text); logic in `src/sim/props.js` (`deriveProps`, `propsOf` non-mutating fallback, `setProps` at staged open, `liveProps`, `findProp`, `takeProp`). stage_scene `cast.item` = give_item name the first prop holds. Renderer `sceneItem` = first live prop id (read only). `examine`/`search` (search.js) match a prop at the hero's own `sceneOf` scene first; search hands `item` through `foundItem`, sets `item=null`. give_item (levers.js) calls `takeProp` -> `gone`.

**Why:** the sim had no record of the prop. **How to apply:** other scene openers need no change (derived lazily); no RNG, hashcheck unchanged.

Pitfalls: an apostrophe inside a single-quoted test string or STAGE_USAGE breaks the whole module (every check then fails with SyntaxError); a search test with the item already given hits "carried".
