---
name: artreview
description: Reviewing a generated art batch (#177): scratch copy of pipeline PRs, reprocess with --dir, montage and in-game checks, what pixel-xl gets wrong
metadata:
  type: project
---
- First ZeroGPU batch (2026-11-03, 96 raws, pixel-xl on the Space): only 4 of 96 accepted (stone hall and chapel, timber
  auction and smithy). pixel-xl ignores layout prompts: autotiles come back as little top-down maps (all 24 fail the #748
  piece check), sprite "sheets" are loose asset sheets with props and varying figure counts (all 18 fail #749's 3x4
  layout), ground tiles read as bricks/flagstones/furniture, rocks are texture fields, buildings often keep their sky or
  a stone frame as background (stone-inn, stone-auction, lair landmark).
- **Why:** owner wants generated art but strict review; rejected keys are simply remade later.
- **How to apply:** expect the next batches of these kinds to fail the same way until prompts/models change; tell the
  caller so. One accepted tree variant replaces every tree of that biome (pickVariant falls through), so judge props
  at map zoom 1, not only at zoom 4: the meadow tree's grey plinth turned forests into a dotted lattice there.
- Review recipe: `git archive` the pipeline PR branch into the scratchpad, overlay the other PR's files, junction
  node_modules, copy raw/ + index.json into `<scratch>/assets/incoming/<day>/`, run
  `node scripts/art/reprocess.mjs <day> --dir <scratch>/assets`. A small Node montage on scripts/art/png.mjs
  (decodePng/encodePng, nearest upscale, 3x3 tiling for seams) is faster to read than sheet.html.
  Accept by copying PNGs and writing index entries like accept.mjs (`{...inboxMeta, id, tier, file, sha256, accepted}`,
  no `alt`, keys sorted, JSON indent 1). Plain `node node_modules/vite/bin/vite.js --port 59xx` works in a worktree
  outside .claude. See [[previews]], [[towns]], [[autotile]].
