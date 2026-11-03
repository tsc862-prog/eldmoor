---
name: search-examine
description: #525 search/examine hero tools: src/sim/search.js, marker reveal/cache via mark_place flat args, hash roll, cooldown, pitfalls
metadata:
  type: project
---

`search {what?}` (act, 20 game min as a `rest` pq entry with `search:true`) and `examine {what?}` (read only) in `src/sim/search.js`, wired in player.js T. Targets: DM markers (S.places) and landmarks within sight (search needs `SR.REACH` 6 tiles), else the ground (tracks of creatures within 10 tiles, taught through lore `sight`). Roll: d20 from `hash(hero, strHash(spotKey), attempt n)` + best of lore/perception vs `SR.DC[kind]`; no RNG, no numbers to the hero (d20/dc/mod go to the dmlog kind `search`). Spot state in `a.srch[key]={n,at,ok,text}`; any search starts `SR.COOL` 360 min cooldown; a found spot with text answers "already searched".
- DM hides things with mark_place flat args `reveal` (200) and `cache` ("25 gold" up to 60, or an item as give_item takes it, via `foundItem` in levers.js); stored on the S.places marker by `via.after` in dmagent.js flatLever. One finder takes the cache (`cacheBy`).
- Find kept in lore place entry (`lore.found`, shown in `lore`/placeLine). Crypt sign (#448) is read in full by examine/search at the mouth.
- Companions in earshot get "X searches Y." (notify); not in fights/dungeon/road home.
- Pitfall: lorecheck restores a snapshot mid-file, so `A` is a stale object: re-find the hero by id (`Q`) before using playerAct in later blocks. Bash `/tmp` is not node's `/tmp` (E:\tmp): use the scratchpad for helper scripts, never `python -` (hangs).
- Not done: scene props (#545 not merged), ground items (none exist yet), Table mystery already has its own `search` act.
