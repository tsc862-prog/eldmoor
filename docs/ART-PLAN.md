# Art plan: a cohesive, readable world view (#176)

Owner: pixel-artist (`src/render/*`). The UI panels belong to the ui-designer; the two
share one colour vocabulary (below). Art stays code-only, the map hash never changes, the
sim is never touched.

## How this was audited

Real screenshots from headless Chrome driven over the DevTools protocol against a vite dev
server on a spare port: each world warmed up for 300 game seconds, the free camera set to
zoom 1, 1.6, 2.6 and 4 over towns, roads, every biome, Kragmaw's lair and the crypts, at
noon and at 23:00, plus the follow camera. Both worlds: Eldmoor (80x50) and the Stepping
Lands (`?world=stepping`, 160x100).

## What reads badly

### Bugs (wrong art, not taste)
1. **Biome art is keyed by zone index, not biome.** `terrain.js` paints pines when
   `zone===3` and swamp trees when `zone===1`; the minimap's forest colour is a per-zone
   list. On the Stepping Lands zone 3 is Cinderreach (ash) and zones 4-5 are the tundra, so
   Rimeholt and Palereach grow green Thornvale oaks on snow (bright green blobs at every
   zoom and on the minimap) and Cinderreach would get snowy pines. Breaks the "never
   hard-code zones" rule.
2. **Only the first crypt has a mouth.** The Hollow Cairn on the Stepping Lands is an
   invisible landmark.
3. **The crypt label sits at a hard-coded y (40.4 tiles).** On the Stepping Lands
   "SUNKEN CRYPT" floats over Cairnwold, 45 tiles from the crypt.
4. **Weather is drawn after the night overlay**, so fog (a 35% white wash) turns whole
   regions pale grey at midnight, brighter than the day-lit towns.
5. **Edge labels are clipped**: "GRIMHOLD" (y 49.2 of 50) falls off the bottom at zoom 1.

### Terrain
- Every biome boundary is a hard, tile-aligned square edge: meadow to fen, fen to ash, ash
  to snow, grass to road. Roads read as stair-stepped tile strips.
- Mountains: every top tile of a massif draws its own little snow triangle, so ranges read
  as a picket fence of identical icons; the faces below are flat grey with vertical light
  and shadow stripes.
- Rock (ash) and peak greys are the same value as the road at a distance; Cinderpass is
  one grey mass with lava.
- Lava does not light anything at night; it turns as dark as the rock around it.

### Sprites
- No outlines. Pale monsters (wights, rimehounds) vanish on snow; brown boars on mud; the
  hero's dark legs vanish on dark ground.
- Hero class reads only from a 3-pixel accent (two pauldrons and an emblem); at zoom 1.6
  and below every hero is "a blue or red figure". The UI colours names by class
  (`CLS[cls].acc`), the map does not show it.
- Faction colours are the same blue and red as the Fellowship role colours (tank blue, DPS
  red), so a role diamond over a Concord hero reads as a faction mark. (FAC is
  character-builder's table; flagged, not changed.)
- NPC disposition is only a nameplate colour, three different ad-hoc shades, and only on
  DM-placed wanderers.

### Labels and markers
- At zoom 1 the Fellowship's five names are drawn on top of each other in town
  ("Wrackur Zhalaelaque").
- At zoom 2.6 every hero, townsperson, elite, grave and camp is named: a busy road is a
  wall of text.
- Region, town and landmark labels use the same size and colour; nothing says which is a
  place and which is a region.

### Lighting and effects
- Torch light is a flat, static gradient; lava, the crypt glow and the lair have none.
- Bolts are a 3x2 rectangle; nothing marks a hit.

### Minimap
- Same zone-index bug as the terrain (green tundra forests on the Stepping Lands).
- No towns or landmarks on it; the hero dots (faction blue on river blue, red on lava)
  have no edge.

## Target palette and style rules

One module, `src/render/palette.js`, holds every colour the renderer uses outside the
pixel tables, plus the terrain ramps the minimap is derived from.

**Shared with the UI (must match `src/style.css`):**

| Token | Hex | Used for |
| --- | --- | --- |
| `gold` | `#f2c14e` | selection, quest marks, gold |
| `blue` | `#5b8ff2` | Concord, tank |
| `red` / `hostile` | `#e8544a` | Warband, DPS, hostile |
| `amber` / `neutral` | `#f0a040` | neutral |
| `green` / `friendly` | `#7dce5a` | healer, friendly |
| `ink` | `#ece6d2` | label text |
| `dim` | `#8f8ca8` | the dead, memorials |
| class colours | `CLS[cls].acc` | `classColor(cls)`; the UI's `classColor` must return the same |

**Style rules**
- **Light from the top left.** Lit faces up and left, shadows down and right; every tile
  and sprite follows it.
- **Outlines:** entity sprites (heroes, monsters, townsfolk, the boss) get a 1-pixel dark
  outline (`#100c16`, 85% alpha) so they read on any ground. Terrain and props have none.
- **Contrast:** ground stays in the middle values; entities and markers own the extremes.
  No ground colour is brighter than the snow highlight or darker than the river shadow.
- **Silhouettes:** a class reads from its weapon and accent at zoom 2.6 and above; below
  that a hero is a pip in class colour with a faction edge.
- **Text:** one font (VT323) with a 1-pixel shadow; regions large and pale, towns and
  landmarks in gold, people by disposition or class. Labels never overlap: lower-priority
  labels give way.

## Order of work (one PR each)
1. Shared palette (`palette.js`), this plan, and the Stepping Lands biome bugs that are
   pure lookups (trees and minimap by biome, every crypt mouth and label).
2. Terrain cohesion: dithered biome edges, ridge-line mountains, ash and road values.
3. Sprite readability: outlines, class colour on heroes, disposition cues on NPCs.
4. Labels and markers by zoom, with overlap rejection.
5. Lighting and effects: weather under the night, lava glow, flickering torches, bolt
   trails and hit sparks.
6. Minimap: biome colours from the terrain ramps, towns and landmarks, outlined dots.

## Before and after
Each PR body carries its before/after notes; previews are rendered from the dev server
with the same camera positions so they compare one to one.

## Where the images are made (#703)

Default: the owner's private ZeroGPU Space `tsc862/eldmoor-art` (source in `scripts/art/space/`, pushed with
`npm run art:space -- --push`). SDXL with the pixel-xl and pixel-redmond LoRAs, the manifest's prompts and seeds, the
same post-processing. Each image costs $0 and a few seconds of the PRO account's 40 daily ZeroGPU minutes; the daily run
stops at 36 counted minutes or at the Space's quota refusal and the loop resumes at the quota's reset time. The
Inference Providers router (fal-ai, billed against the $2.00 monthly credit) is the paid exception: only with
`--provider router`, never as a fallback. Images regenerated on the Space are not pixel-identical to the router's, so a
regenerated set goes through review (`npm run art:accept`) as a new set with provider `space` in the index.
