---
name: valestack
description: #980 Vale stack landed as one integration branch: merge order, the shadow-pass trap, stacked PRs may stay open after landing
metadata:
  type: project
---
#979 step 1 (2026-11-06): ten Vale PRs went in as one branch, render/vale-stack (PR #980), because CI merges one PR per 15-20 min. The Vale stays non-default; the owner decides the default.

- Order that worked: #886, #899, #947, #952, #951, #953, #854, #941, #897, #948.
- **Why:** a conflict can hide a contract change: main's #894 moved shadows out of drawTrafficEnt, so #897's `shadow` argument would have been undefined; read what each side removed.
- **How to apply:** a PR stacked on a branch other than main may not read as merged when its commits land through another PR; check after landing and tell the manager. See [[lpchouses]], [[entitylod]].
