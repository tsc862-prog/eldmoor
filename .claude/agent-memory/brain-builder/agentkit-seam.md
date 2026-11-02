---
name: agentkit-seam
description: #290/#294 agentkit design: adapter interface items, existing registries to reuse, carve order K1-K10, the coupling points and risks
metadata:
  type: project
---

The seam design for extracting the agent-play engine lives in `docs/agentkit.md` (issue #294, step 1 of epic #290;
written 2026-11-02 against main cf65828). Owner review comes before any code moves.

**Why:** the owner wants other games played by AI agents and run by a GM agent to reuse Eldmoor's framework.

**How to apply:**
- Adapter items: identity/seats/clock, player tools table + act/wait, the brief (kit fields vs game fields + briefText),
  events via notify levels 0-3, decision points (runlink primitives + game options/reflex/windows), scene kinds
  (`setSceneKind` shape `{options, reflex, apply, outcome}` + PLAY turns/all), GM tools + `playersFirst` signature,
  channels (`hear`, `plantSecrets`), persistence (field names kept), prompts and `/decide` kinds, watch digest.
- Existing registries to reuse rather than invent: `setSceneKind`, `setRunnerLinks`/`setReflexAck`, `setChapterWriter`,
  `setProposeHook`, `setStageHooks`.
- Carve order proposed: K1 skeleton + adapter contract, K2 clean Node leaves (providers, warmup, agent-chat,
  behavior-turn, agent-sessions), K3 relay/MCP, K4 runner core, K5 adapter 2 phase 1 (Liar's Dice, kitcheck in CI),
  K6 sim-side kit modules, K7 table + votes, K8 GM seat, K9 adapter 2 GM + scenes, K10 checks on both + drop shims.
- Hard constraints: old paths keep re-export shims; X-Eldmoor-* headers and `hero` bodies stay accepted; hero field
  names (a.player, a.playEv*, a.memories, a.tiers, a.reflect, S.dmAgent, S.table, S.staged) are not renamed in step 2;
  scene registration order must be kept (crawl.js and staged.js register at import); sim hash and crawl baseline
  must not move.
- Open owner questions (see doc section 7): real-time vs turn-based next game, browser widgets in the kit, package
  shape/name, which Eldmoor rules become kit defaults, GM count, Agent SDK vs one loop, adapter 2 choice, freeze window,
  wire rename.

Related: [[agent-player]], [[runner-pacing]], [[table-turns]], [[dm-agent]], [[in-game-channels]].
