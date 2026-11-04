---
name: freepacks
description: #789 free art sets (Kenney CC0, LPC base + generator, Ninja Adventure by hand) - what fits, how they are cut, staging in-game review shots
metadata:
  type: project
---
#789 (branch render/free-art-packs, 2026-11-04). Owner allowed CC0 and LPC; credit in docs/CREDITS.md, `source`/`license` on index entries.

- `scripts/art/packs.mjs` (`npm run art:packs`) fetches into gitignored `assets/packs/<set>/`: Kenney through the page's own
  cookie + `/download-link/<hex of assets/slug>` flow (works without a browser), LPC base from OGA, the generator as a blobless
  sparse git clone (full repo is ~940 MB: `LPC_PATHS` lists the layer folders fetched, add one to review more). Itch (Ninja
  Adventure) needs a browser click: the owner drops the zip in `assets/packs/ninja-adventure/`.
- Verdicts: LPC terrain and LPC generator heroes FIT (very close to the SNES/Mana look, 32 px native, a 64x64 LPC walk frame holds a
  ~30x48 figure so it is cropped to 32x48, never downscaled). Kenney (flat lime/peach, thick black outlines) does NOT fit.
  LPC trees are bigger than our one-tile prop contract (props are tile-limited), LPC buildings need hand composition.
- Licences: LPC CREDITS.csv rows are keyed by layer folder; some layers are OGA-BY 3.0 only (arming sword), some GPL/CC-BY only
  (`hair/long_messy`, refused by `licenceOk`). The hero sheets carry CC-BY-SA 3.0.
- Staging a review shot with pack pieces in the real game: install PNGs via `setAssetPixels` from `/assets/packs/...` (vite serves
  the worktree root), view = follow (`C.select(hero); C.setView('follow')`), NOT map zoom 1 (that shows the whole map small).
  A scratch vite config needs `root`, `cacheDir` in temp, `watch.ignored` incl. `assets/packs`. Run the shot script from
  powershell.exe; stale Chrome on a fixed debug port breaks the next run (use a random port). `main.js` globs `../assets/*/*/*.png`,
  so `!../assets/packs/**` must stay excluded or pack PNGs end up in dist.
- A hung `cat > file` with no heredoc in the Bash tool blocks for 120 s; Write the file instead.
