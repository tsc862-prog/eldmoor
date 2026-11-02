---
name: memory-tab-patched
description: Memory tab is patched in place (no signature rebuild); search handler lives on input.oninput
metadata:
  type: project
---

Memory tab uses patch() with data-k rows (notes: n<id>). The search input handler is copied by oninput and finds the live .nbl list beside it, so reused inputs keep working. uismoke asserts scroll held across a new memory (#250).
