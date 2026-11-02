# Watcher UI: audit and plan (issue #145)

The owner watches five agent-played heroes tell a story in a living world. The screen should
make that story easy to follow at a glance, and keep everything else one click away. Since #68
every feature has added its own panel, button or badge. The result has four logs, five places to
change a hero's mind, and a World bar with 17 buttons.

This document has three parts: what each surface is for, where the same thing is shown twice,
and the information architecture the next PRs build toward. The first part of #145, stable
scrolling (`src/ui/stable.js`, `npm run uismoke`), is already done. Every panel below patches in
place, so this plan is free to move things without worrying about rebuilds.

## 1. Audit

"Glance" means the owner needs it on screen while watching. "On demand" means one click away is fine.

| Surface | Where | What it is for | Glance or on demand | Duplicates |
| --- | --- | --- | --- | --- |
| Header | top | Title, a three-line pitch, the clock | Clock: glance. Pitch: never after the first visit | none |
| Party frames | above the map | The five: HP, doing, target, conditions, mind, runner | **glance**: the heart of the screen | HP/XP in the dossier header; mind label in Minds at play; mind control in the roster |
| Map, minimap, labels, bubbles | centre | Where everyone is; speech | glance | bubbles repeat the Chat tab (fine: different job) |
| Table banner | over the map | The scene, initiative, whose turn | glance while a scene runs | none |
| Runner-stop alert | over the map | A Fellowship or DM runner died; pause | glance when it fires | none |
| Speed group | under the map | Pause, 1x, 3x, 8x | glance | none |
| View group | under the map | Whole map, Follow, Fellowship, Next hero, zoom; also Table: Auto, Alert on runner stop, Sound | Camera: glance. The three switches are settings, set once | none, but they are settings shown as camera buttons |
| World group | under the map | Save, Load, Export, Import, New world, Developer, save status | on demand | none, but loud for things used once a session |
| Hero dossier header | under the map | Name, mind label, AI/Agent buttons, level line, doing, HP, XP | glance for the selected hero | frames for members (HP, doing, mind) |
| Dossier tabs (10) | under the map | Stats, Log, Bio, Memory, Gear, Pack, Party, Chat, Mind, Agent | on demand | Party tab repeats the frames for members; Gear repeats the Compare sheet; Bio and Memory both show the backstory |
| Fellowship panel | side, top | Name, Follow/Minds/Disband, Start all five, roster with a mind row per member, relay writing stats, model request stats, Open threads, Fallen, Campaign log | Name and standing: glance. Roster settings, stats: on demand | Follow duplicates View > Fellowship; mind rows duplicate the frames' mind button and the dossier's AI/Agent; Fallen duplicates Graveyard |
| Chronicle | side | The world's running log, with a "Fellowship only" filter | glance | overlaps the Campaign log and the Timeline |
| Minds at play | side | Every AI- or agent-played hero with its latest call; the DM row | on demand (glance only when debugging a runner) | frames show the members' mind and link; DM row duplicates the DM seat |
| World group (folded) | side, bottom | Factions, Top heroes, Guilds, Graveyard, Timeline, Legends, Dungeon Master, Auction house | on demand | Timeline overlaps the Chronicle |
| Dungeon Master | in World | DM seat (open, mind, Start DM) and the DM log with filters | Seat: on demand. Log: on demand | the seat appears again in Minds at play |
| Compare sheet | overlay | The five side by side | on demand | none (it is the one comparison) |
| Setup page | overlay | New world: places, minds, DM, start runners | on demand | none |
| Runner controls | frames, roster, Agent tab, Fellowship panel, DM seat | Start/Stop a runner, its state, the mind it starts with and a turn cap | on demand | **five** copies of the same control; turn cap only on the start picker; no budget, no global spend |

### Duplicates worth removing

1. **Changing a hero's mind** happens in five places: the frame's `-> AI` button, the roster's
   Scripted/AI/Agent row, the dossier header's AI and Agent buttons, the Agent tab's runner
   control, and the Fellowship's "Minds" cycle. Keep one control per hero, the roster's mind row,
   and one for the five, the Minds switch. Everywhere else shows the one mind label (`mindLabel`).
2. **Runner start/stop and limits** are spread over five controls, with no place to see the
   total spend. Move them into one Agents panel (Part 3 of #145).
3. **Live member state.** The frames already carry HP, doing, target and mind. Hide the Party tab
   for members, and drop the members from Minds at play when the frames are shown.
4. **Logs.** There are four: the Chronicle, the Campaign log, the Timeline and the DM log. Keep
   the Chronicle as the glance log. The Campaign log becomes a tab of the same Story panel. The
   Timeline joins it as a filter. The DM log stays in the World group (it is a backstage log).
5. **The dead.** Fellowship "Fallen", Graveyard and Legends all list them. Keep the Graveyard in
   World, and show Fellowship fallen as a filter of the Campaign log.
6. **Backstory** appears in both Bio and Memory. Show it once, in Story > Bio.

## 2. Information architecture

These principles apply in Fellowship mode. Without a Fellowship, the page keeps today's
world-first column order, with the same quieter bars.

- **Glance:** the frames, the map with its banners, the selected hero's header, the Chronicle
  and the clock. Nothing else is always visible.
- **One click:** everything else, grouped under four doors. These are the dossier's three tab
  groups, the Story panel's tabs, the folded World group, and two small popovers in the top bar:
  **Agents** (minds, runners, limits, spend) and **Settings** (Table mode, sound, runner alert,
  world chatter, developer).
- **One place per fact.** HP lives in the frames and the dossier header. A mind is changed in
  the roster's mind row, and the Fellowship's Minds switch for all five. A runner is started and
  limited in Agents.
- **Consistent chrome.** Every panel header uses one style (Press Start 2P, 10 px, gold), the
  same 12 px padding and 14 px gaps. Body text is VT323 at 18 or 20 px only. Buttons come in
  three sizes (bar, mini, chip) instead of today's seven ad-hoc font sizes.
- **Developer and advanced controls** go behind Settings > Developer. That covers model request
  stats, relay writing stats, AI/Agent buttons on non-members, prompts in the Mind tab, and the
  Minds at play list.

### Before (Fellowship mode, desktop)

```
ELDMOOR  A living world of 28 heroes in four guilds. They quest, trade...   [Day 3 · 14:20]
+-------------------------------------------------+  +-----------------------------------+
| [Tank][Healer][DPS][DPS][DPS]    Compare the five|  | FELLOWSHIP  Follow Minds Disband  |
| +---------------------------------------------+ |  | Start all five  [mind v][turns v] |
| |                                             | |  | Tank  Name  Sheet Remove          |
| |                 map                         | |  |  [Scripted][AI][Agent] [v][v] ... |
| |                                    minimap  | |  | ... x5 rows of pickers            |
| +---------------------------------------------+ |  | Relay writing: ... Model req: ... |
| Speed[Pause 1x 3x 8x] View[Whole map Follow     |  | > Open threads  > Fallen          |
|  Fellowship Table:Auto Alert on runner stop:on  |  | v Campaign log (days)             |
|  Sound:on Next hero - +] World[Save Load Export |  +-----------------------------------+
|  Import New world Developer] Auto-save on       |  | CHRONICLE        [Fellowship only]|
| +---------------------------------------------+ |  +-----------------------------------+
| | HERO  Name [Agent (haiku · live)] [AI][Agent]| |  | v MINDS AT PLAY (6)               |
| | meta / doing / HP / XP                      | |  |   DM row [Close seat][v][Start DM]|
| | Stats Log Bio Memory Gear Pack Party Chat   | |  |   5 members + others              |
| | Mind Agent                                  | |  +-----------------------------------+
| | ...tab body...                              | |  | > WORLD (8 panels)                |
| +---------------------------------------------+ |  +-----------------------------------+
```

### After

```
ELDMOOR                       [Day 3 · 14:20]  [Agents $0.42 / $5]  [Settings]  [World v]
+-------------------------------------------------+  +-----------------------------------+
| THE MUD FIVE  4 of 5 standing     Follow Compare|  | STORY  [Chronicle][Campaign][Time]|
| [Tank][Healer][DPS][DPS][DPS]   (mind label only)|  |  02:51 Nevith takes the ford job  |
| +---------------------------------------------+ |  |  02:52 [Party] Halara: ...        |
| |                 map                         | |  |  ...                              |
| |   (Table banner / runner alert overlays)    | |  |  filter: [Fellowship][World][All] |
| |                                    minimap  | |  +-----------------------------------+
| +---------------------------------------------+ |  | > Members and minds (roster,      |
| [Pause 1x 3x 8x]   [Map Follow Fellowship] - +   |  |   one mind row each, Sheet)       |
| +---------------------------------------------+ |  | > Open threads                    |
| | Nevith  Lv 9 Priest · Healer  [Agent · live]| |  +-----------------------------------+
| | doing / HP / XP                             | |  | > WORLD  factions, top heroes,    |
| | [Character] [Story] [Mind]                  | |  |   guilds, graveyard, legends,     |
| |   Character: Stats · Gear · Pack            | |  |   Dungeon Master, auction house   |
| |   Story:     Log · Bio · Memory             | |  +-----------------------------------+
| |   Mind:      Chat · Agent · Mind            | |
| +---------------------------------------------+ |
```

- **Agents** (popover from the top bar): one row per runner (Fellowship, each hero runner, DM)
  with state, model, turns and cost, a turn cap ("until stopped" for local models) and a budget
  for paid models. Above the rows: a global session budget with the live spend. The DM seat's
  Open/Close moves here too. Minds at play folds into this popover, as a debugging list.
- **Settings** (popover): Table mode Auto/Off, Sound, Alert on runner stop (sound), Run without agents (Developer), World chatter and
  Developer. All are kept per viewer, as today.
- **World v** (menu): Save, Load, Export, Import, New world, and the save status as its subtitle.
- **Phone width:** the top bar wraps into two rows: title and clock, then the three buttons. The
  frames go to a 3+2 grid (already done). The side column stacks under the dossier. Popovers open
  as full-width sheets with a 16 px gutter. Nothing scrolls sideways.
- **Keyboard:** popovers and menus are `<details>` or buttons with `aria-expanded`. Escape closes
  them and focus returns to the opener. The dossier's groups and sub-tabs use arrow keys inside
  a `role=tablist`.

## 3. Delivery

Each step is a small PR checked by `npm run uismoke`, which grows a check per step.

1. `ui/stable-scroll`: patch in place, keep scroll (done, #150). `ui/chat-lines`: the Chat tab on
   one line per message (#151).
2. `ui/agent-limits`: the Agents popover with per-runner turn caps and budgets, a global session
   budget with live spend, enforced by the runner supervisor (`scripts/runners.mjs`, checked in
   `runnercheck`).
3. `ui/declutter-bars`: a short header, the Settings popover, the World menu, and one header
   style with spacing and type tokens.
4. `ui/declutter-dossier`: the three tab groups. The Party tab is hidden for members. One mind
   control: the header loses its AI/Agent buttons for members, and the frames lose their cycle
   button.
5. `ui/declutter-side`: the Fellowship card above the frames, the Story panel (Chronicle,
   Campaign, Timeline), Members and minds folded, Minds at play and the dev stats behind
   Agents/Developer. Closes #145.

## Run gate (#171)

The world runs only while every required agent seat is connected: each living Fellowship member and the DM seat when the DM agent is chosen (`src/ui/rungate.js`). A missing seat holds the world (speed buttons other than Pause are inert; the owner's speed is kept, so it resumes by itself, and a world the owner paused stays paused). A bar over the map lists who is missing and why, with Start / Restart per seat and Start all. A seat live within the last 20 s still counts (no flicker). A new world starts held until its runners claim. Developer-only "Run without agents" (Settings, this session) skips the gate. The old runner-stop alert's "Resume without it" is gone.
