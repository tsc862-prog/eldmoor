---
name: comment-code-check
description: #935 commentcodecheck in rulescheck; a trailing // swallowed Chronicle code; body margin 8px overflow
metadata:
  type: project
---
Long one-line code with a trailing `//` comment hides any code written after it (#933 panels.js). `scripts/commentcodecheck.mjs` runs inside rulescheck. uismoke asserts Chronicle rows have text. Docked layout: html,body overflow hidden needs body margin 0 or the document is 8px too tall. Vite on a spare port needs a config with cacheDir (no CLI flag): see logs/tmp/vite.cfg.mjs idea.
