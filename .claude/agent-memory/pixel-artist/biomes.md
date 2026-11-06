---
name: biomes
description: #835 LPC biome ground (fen, swamp, mud, ash, snow, ice, lava) and borders - atlas layout, pair table, what broke and how it was fixed
metadata:
  type: project
---
#835 (branch render/lpc-biomes, 2026-11-04). Source: OGA "[LPC] Terrains" (bluecarrot16 et al., CC-BY-SA 3.0/4.0), fetched with
`npm run art:packs -- --only lpc-terrains` into gitignored assets/packs/lpc-terrains; cutter `scripts/art/packcut-biomes.mjs`
(`node scripts/art/packcut-biomes.mjs --index`), table `BIOME_PAIRS` (id, A plain underneath, B island on top) must match `PAIRS` in terrain.js.

- Atlas terrain-v7.png: ten 3x6 LPC blocks across (block i at tile x 3i), bands 7 tiles apart (band 0 dirt/rock/mud, 1 grass/snow, 2 water/lava, 3 ice/sand).
  The atlas Ice block's island is OPAQUE (snow blob on its own ice background) so it cannot be an island over another ground; use the Snow_1
  island over the Ice plain. Star-shaped holes (snow) make bad inner corners: `synthInner` builds the inner piece from the edge piece.
- Plain tiles: pick the plainest variant per ground (`PLAIN`); Rock_Gray variant 0 has a star blot that reads as a grid when repeated.
- Tile assets are one 32 px patch (manifest sizes) so terrain.js flips each tile 4 ways by hash (`SCATTER`, `flipOf`) to hide the repeat.
- Trees and peaks are objects with procedural ground behind them: `texel(..., noBg)` answers null for plain ground so the biome asset paints it,
  and `groundAt` makes them count as their biome ground for transition pairs. Without that every pine sat on a flat procedural snow square.
- Three ground types round a corner (mosaic fens have them everywhere): `autotileAt` takes the majority type plus the highest `RANK` single; the
  odd tile keeps its own ground in its quarter (`self` arg). That removed most jagged fallback blends. The remaining blend is decided per art
  pixel only when a ground asset is loaded (`groundArt()`), so the no-asset render stays the 2x scaled procedural map (artcheck guards it).
- Not covered (blend or procedural): peak borders, lava|peak, ice|fen, mud|river, grass|mud, grass|swamp (rare), mountains/trees/rocks art itself.
- Shots: scratch vite config on 5909 with cacheDir in my own folder, `shot.mjs` boots ?continue=1, teleports the five members to x,y, follow view.
  The C: drive filled up (ENOSPC in artcheck): point TEMP/TMP at a folder on E: for long checks and keep headless Chrome profiles out of C:.
