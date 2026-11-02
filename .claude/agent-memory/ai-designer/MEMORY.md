- [Party rules](party_rules.md) — why followers have their own state, duelers stay, regroup exists, zone = weakest member, 50% outnumbered flee
- [Mirefen PvP dynamics](pvp_dynamics.md) — Mirefen hero-time drives deaths; clustering multiplies duel pairs; how to instrument deaths headlessly
- [Chatter rules](chatter_rules.md) — say() in chat.js, private RNG, lazy per-hero fields, spot at 2+ levels, merge-safe one-line inserts
- [Narrator rules](narrator_rules.md) — why scout pass is a real strike, flee fail is a glancing bite, 20s cap exceptions, baseline variance is 92-124 deaths/2h
- [Spatial index](spatial_index.md) — all proximity scans go through sim/spatial.js; id-sorted results keep RNG order; what was left brute-force and why
- [Rebalance #18](rebalance_issue18.md) — tuned PvP/raid/crypt values, what moved deaths, noise warning, late-game vet PvP caveat
- [DM adventures](dm_adventures.md) — dm.js drives adventures inside travel/hunt, away != failure, hook board, told-budget, XP/honor sizing
- [DM levers](dm_levers.md) — levers.js rules: log folding for volume, ready() before scripted pulls, no-RNG hooks, band clamp, foe levers
- [Fellowship UI](fellowship_ui.md) — #94 layout moves nodes; since #148 members have no Scripted/AI controls, only runner model
- [Rebalance #107](rebalance_issue107.md) — crypt .40, spider/boar softening, xpNeed ramp, replacement seeding, duel .0375; use 10-run batches
- [New world opening](new_world_opening.md) — #111: default Fellowship at L1, others seeded 1-15 (START_BANDS), opt-out flag and which checks use it
- [New World setup](new_world_setup.md) — #133: setup page flow, seeded init, agent-from-minute-one, runner plan/limits, local-model rule
- [Agent tab polish #136](agent_tab_polish.md) — one mind label, day stamps, log sources, runner-stop alert
- [Fellowship always agents](fellowship_always_agents.md) — #148: runlink.js gate (live waits, owner hold, reflex = scripted), 3x drop, check mocks
- [World voice #164](world_voice.md) � S.worldVoice mutes scripted say/npcSay; scripted DM voices NPCs near members; RNG preserved
- [Camp rest #178](camp_rest.md) — camp status text, break_camp vote/tool, rest hours, wake events, sleepers' pacing, onCamp hook
- [Talk range #182](talk_range.md) — shout range, presence councils, couriers, reflex-party exemption, no Party chat tag
<<<<<<< HEAD
- [Learn the world #188](learn_the_world.md) — lore.js: no creature numbers to agents, hash read, text-scan hearing, hunt skips learned fears, known places
=======
- [Table everyone-at-once](table_simultaneous.md) — PLAY kind table, slot-order resolution, parallel waits, presence, staged combined DM call
- [Quest log](quest_log.md) — several quests per hero derived from existing state; taken/held phases agent-only; DM tags h.by/h.ff
- [Action log #248](action_log.md) — actlog.js non-enumerable ring, fight settling, unrecorded kinds, hash proof
>>>>>>> origin/main
