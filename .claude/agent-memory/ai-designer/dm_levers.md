---
name: dm-levers
description: DM world levers (issue #77, sim/levers.js) - design rules not obvious from code - log folding for volume, ready() before scripted pulls, no-RNG hooks, band clamp window, named/custom foe ownership
metadata:
  type: project
---
World levers live in `src/sim/levers.js` (branch ai/levers, 2026-11-01). Rules and why:

- **DM log volume.** Main ran ~141 DM-log entries per game day; logging every lever pull pushed it
  to 174. Fix: scripted board posts (post_hook/withdraw_hook) fold into the board entry, named_foe
  folds into the scene's roll entry, follow-up hooks into the payoff entry (`pull(...,{log:false})`
  returns `entry`; `detail.levers` array). The panel's Levers filter matches `detail.levers` too.
  Result ~137/day. Only real world changes (marks, places, npcs, conditions, price shocks) log alone.
- **Scripted DM calls `ready(name, z)` first**, so a used-up lever is never even tried; otherwise
  limit rejections spam the log. Rejections from model/agent callers are logged on purpose.
- **Hooks into other systems roll no gameplay dice unless a mark/condition applies** (encKind,
  encSpot get `rnd` passed in and short-circuit). Cosmetic picks (names, strolls) use a private LCG.
  levercheck asserts this by passing a throwing rnd.
- **Band rule:** a level up to 3 outside the region band is clamped to [lo, hi+2]; further is
  rejected. Scripted named foes ask for `clamp(hi+1, lo-3, hi+3)` (party top level + 1 used to be
  unclamped: L16 parties in Thornvale got L17 beasts, ~0.7/day).
- **Foes:** named_foe owns the named-beast construction (bestiary leader block); custom_foe wraps
  the bestiary's `customFoe` (tweak budget, CUSTOM.perRegionDay) and places it with spawnFoe.
  create_site / start_event / nudge_relation are stubs: `provide(name, fn)` turns them on.
- register() refuses params named hp/xp/stats/cls/loot/item/kill/revive...: forbidden by construction.
- Attitudes live on the npc (`p.att`), read by npcs.js greet (hostile = no greeting) and dm.js social rolls.

See [[dm-adventures]] for the DM itself and its log rules.
