---
name: map-pack
description: Linked maps #1013 slice 2: save v8, mappack.js rules, who freezes, split keys, stubs never return, heroes away are not gone, IndexedDB mirror, what slice 3 still owes
metadata:
  type: project
---

`sim/mappack.js` is the pack; `switchMap(to, at?)` the one door (pack, setWorld, unpack or spawnAll). Rules added and why (#1013 slice 2):

- Frozen entities stay live objects in `S.maps[id]`, not serialized JSON: a chronicle line, guild or nemesis keeps its object, and save.js writes them by reference through `MAP_HOMES`, with `{ref:'boss',map}` for a frozen map's boss. Plain JSON in S.maps would have left every reference a dead stub after one return.
- Who stays with the company: `inCompany` and alive, plus anyone in a party with them (a party moves as one). Dead company heroes and S.pinned freeze whole. Other dead become stubs **in place** in `m.dead` and never rejoin S.agents: that is a recycled grave, which every reader already takes; S.graves keeps the stone. Stripping into S.agents would have broken scans that read `a.slots` on the dead.
- Splits (`SPLIT`): levers (active, `name:z` cooldowns, day.rz with its day stay with the land; seq, day.n/nf, stats, bare cooldowns, ecoT stay on S), dmSeen (enc with the land, dead campaign), worldEvent (cur, done with the land; lastEnd campaign: it paces the DM).
- SUMMON.ALIVE stays per map, on purpose: it bounds what walks the live sim; the daily cap is campaign-wide with the levers.
- "Not in S.agents" no longer means dead: `isAway(id)`, `awayIn(g)` in atlas.js. Fixed: goals rival and avengeHero (oath voided), sworn protect, bonds (deleted daily), guilds (dwindle, false "its leader has fallen"; a guild with people away holds still), legends (marked dead). Of 382 `S.agents.find`/wrapper calls, 16 read as unguarded and 18 passed on; none crashed: the harm was this presence-means-dead reading, which a deref scan does not see. Look for it, not for TypeErrors.
- A frozen map cut again (spec.rev) is built afresh at switchMap, with a DM log line; only the live map's rev refuses a save. Flat snap.mapRev is the live map's now.
- `restore` switches map only when `campaign.id===WORLD_ID`: an imported save of another campaign is laid on this map as ever.
- Page saves: `ui/savestore.js` mirror. `openSaves()` before the title, then sync reads as ever; writes go on in the background, `afterReset` waits `whenSaved`. No IndexedDB: localStorage, so uismoke and setupsmoke are unchanged. Real Chrome was run once by hand (12 MiB slot); CI has only `scripts/mockidb.mjs`.

**Why:** a save must survive the first road, and a story must not lose an oath or a guild because its people are on another map.

A region index does not cross a map: `p.zone` crashed a day-51 run (fixed in switchMap, found only by the long size run, so keep long runs in mind). `a.goal.zone` is still the old map's index: guarded against the crash, but a pilgrim oath can read as arrived on the far map's same index; slice 5 should give oaths a map.

**How to apply:** slice 3's `cross()` wraps `switchMap`, passing the entry exit as `at`. Still its job: set the adventure aside (`adv.held`), `a.pq`, place-bound whens and watches, `townOf` fallback, a company's mates spread (switchMap stands all on one spot), and the page's render on `onWorld`. A check: `core/rng` stub rules as in [[map_rebind]]; the far map's first tick makes lazy keys, so a save at the moment of the switch lacks them and that is fine. Heredocs in Bash here strip backslashes and break on quotes: write edit scripts with Write.

Related: [[map_rebind]], [[no_lair]], [[multi_dungeon]], [[save_drift]].
