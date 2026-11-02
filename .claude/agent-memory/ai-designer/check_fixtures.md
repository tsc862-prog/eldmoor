---
name: check-fixtures
description: Behaviour changes break checks whose fixtures lean on RNG-left world state; fix the fixture (hold the hero, spawn the mob, assert on snapshot) not the assertion
metadata:
  type: feedback
---

When a behaviour change (e.g. #67 gate-captain bounties) shifts what heroes do, checks fail where their fixtures relied on incidental world state: an unheld Fellowship member parked in the field dies before its step (behaviorcheck lever-near-hurt), no live mob of a type is left (lorecheck), the test hero is mid-fight so a raw JSON.stringify hits hero.target/mob.target cycles (actcheck), brain heroes stay in the field and ask no town plan.

**Why:** CI groups stop at the first failing step, so one fragile fixture hides later checks; weakening assertions was ruled out by the owner.
**How to apply:** after any loop change, run every check in the affected CI groups locally (sequentially; parallel load makes localcheck flake). Hold members with a mock claim and park them in town, spawn needed mobs via `spawnMob`, assert "not saved" on `save.js snapshot()`. Python rewrites on Windows turn files CRLF in the working copy (git normalizes on commit).
