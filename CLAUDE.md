# Eldmoor

An 8-bit "ant farm" MMO simulation inspired by classic MMOs. The player does not
control anyone: AI heroes from two factions level up, quest, trade, duel, hold
grudges, run a dungeon and raid a world boss on their own, and the player watches.

## Hard rules

- **Own world, borrowed words are fine.** This is a personal project, so copyright is not a concern.
  Generic fantasy names and ability or item names that also appear in other games (Ambush, Sanctuary,
  Bastion) are fine. Don't copy a franchise's distinctive proper nouns wholesale (Azeroth, Horde,
  Alliance, Stormwind, Arthas) or its maps, sprites and sounds; Eldmoor keeps its own places, peoples
  and characters. Prefer names that sound good over names that are merely unique.
- **Hardcore.** Every hero has one life. Death is permanent; a fresh level-1
  recruit of the same class and guild replaces them.
- **The Fellowship is always agent-played.** Every Fellowship member (and every replacement) is
  controlled by an agent at all times; there is no scripted or single-call AI mode for members. Between
  decisions a member may auto-play (autopilot: carry out the last order, follow the leader, reflexes such as
  defend, drink a potion, flee below 15% HP), but every decision belongs to its agent: votes, proposals,
  lead_to, Table scene choices, jobs, splitting off, what to say. A decision point waits for the agent
  (Table mode pauses the world at 1x); reflex choices are only a fallback when the runner is gone, and then
  the runner-stop alert pauses the world and asks the owner. Background heroes may be scripted.
- **In-game channels only.** The DM and the players (Fellowship members, agent-played heroes)
  communicate only inside the game: in-game chat (say in earshot, the party channel, townsfolk, the
  DM's `narrate` and `npc_say`) and what their characters can see. Nobody messages anyone directly
  outside it. A hero's tools, runner prompts and brain snapshots never carry DM notes, the DM log,
  lever reasons, or another hero's journal, memories, persona, mind, narration or session; a claimed
  hero answers only its own runner; heroes have no DM tools and the DM no hero tools. The watcher
  (the owner's browser) still sees everything. See "In-game channels" below; `npm run channelcheck`.
- **No build step required for the art.** All terrain and sprites are generated
  in code (pixel arrays and procedural textures). No image assets yet.
- **Built to scale.** The world will grow 20-30x with several races and home
  towns per faction (see the scaling epic on GitHub). Never hard-code the number
  of zones, factions, cities or races; loop over the tables. Never assume a zone
  is a vertical band or where it sits on the map; ask the world module
  (`zoneAt`, `zoneFor`, `CITY`). Keep entity scans in one helper each so they can
  move to a spatial index.
- After any change to simulation logic, run `npm run sim` (and `npm run sim -- 120`
  for balance work) and check the summary still looks sane.

## Agent team

Dedicated subagents live in `.claude/agents/`. Delegate to them by area:

| Agent | Owns |
| --- | --- |
| `world-builder` | Map, zones, terrain, cities, dungeons, landmarks, world events |
| `character-builder` | Classes, factions, guilds, names, hero sprites, stats, traits |
| `creature-designer` | Monsters, bosses, loot, epics, auction-house economy |
| `ai-designer` | Hero behavior: states, questing, PvP, grudges, dungeons, raids |
| `balance-tester` | Read-only headless sim runs and balance reports |
| `lore-keeper` | `docs/LORE.md`, flavor text, originality checks |
| `brain-builder` | Model-played heroes: decision-policy interface, local relay, prompts, fallbacks; generated narrator and chatter modes |
| `pm` | Backlog triage, issues and labels, priority order, briefs for next pickups, board snapshot and status summaries (no code, no merges, no dispatch) |
| `playtest-reviewer` | Reads DM and character behavior logs (runner logs, sessions, relay, `logs/behavior/`) after play and files evidenced issues (no code, no merges) |
| `ui-designer` | The watcher interface: layout, panels, dossier tabs, Fellowship panel and frames, Table banner, Agent/Mind/Chat tabs, setup page, styles, scrolling, phone width |

Models per agent (set in each agent's frontmatter): Opus for `ai-designer`, `brain-builder` and `ui-designer` (shared-file behaviour and runtime model code), Sonnet for `world-builder`, `creature-designer`, `character-builder`, `lore-keeper`, `balance-tester` (bounded work checked by sims and review), Haiku for `pm` (triage and board), Sonnet for `playtest-reviewer`. Quick read-only checks (a short lore pass, a board sync) may run on Haiku by overriding `model` on the call; full originality reviews stay on Sonnet. Escalate a single task to Opus by overriding `model` on the Agent call; use Fable only for hard architecture.

For a feature that spans areas (for example a new zone with new monsters), plan it,
hand each part to its owner, then have `lore-keeper` check names and
`balance-tester` check the numbers. `docs/LORE.md` is the shared canon.

## Working in parallel (agents and people)

The repo is set up so several agents can work at once without stepping on each
other. The rules:

- **One task, one branch, one area.** Branch from `main` as
  `<area>/<short-name>` (for example `world/hoarfell-weather`). Edit only files
  your area owns (see the ownership table below). If you must touch another
  area's file, keep the edit minimal and list it under "Out-of-area edits" in
  the PR.
- **Parallel work uses worktrees.** `git worktree add ../eldmoor-<area> -b <area>/<name>`
  gives each agent its own checkout; never have two agents editing one working
  tree.
- **Small PRs, always green.** Every PR runs `npm run build` and a headless sim in
  CI. Paste the `npm run sim` summary in the PR body. Balance-sensitive changes
  also include `npm run sim -- 120`.
- **Names go through lore.** Anything newly named (zone, creature, item, NPC,
  guild, quest) is added to `docs/LORE.md` in the same PR, and `lore-keeper`
  checks originality before merge.
- **Numbers go through balance.** Changes to stats, mobs, bosses, XP or AI get a
  `balance-tester` report before merge.
- **Issues are the queue.** Work is tracked as GitHub issues labelled
  `area:<area>`; an issue labelled `agent-ready` is scoped enough to hand to the
  owning agent with no further questions. Pick one, branch, PR, close it.
- **Shared data tables are append-only during a feature.** Adding a row to
  `MOBS`, `EPICS`, `GOODS`, `CLS` or a zone list is fine in parallel; renaming or
  reordering existing rows is a coordinated change done alone on `main`.

## Commands

- `npm install` once, then `npm run dev` to play at http://localhost:5173
- `npm run sim [minutes]`: headless run of the real game code in Node, prints
  levels, deaths, honor, guild dungeon results and boss state.
- `npm run build`: static build into `dist/`.
- Worlds: Eldmoor (80x50) by default; `?world=stepping` in the browser or `ELDMOOR_WORLD=stepping` in Node selects the 160x100 Stepping Lands test continent (saves are kept per world).
- New worlds (#111): `init()` founds the default Fellowship (level 1, home town, Minds scripted) and starts the other heroes at levels 1-15 in fitting zones (`src/sim/opening.js`, `START_BANDS`). `ELDMOOR_FELLOWSHIP=0` in Node, `?fellowship=0` in the browser or `init({fellowship:false})` keeps the old all-level-1 start for balance baselines; checks that found their own Fellowship use it.
- `npm run worldcheck`: builds the world specs headlessly and checks the Eldmoor map hash.
- `npm run savecheck`: snapshot/restore round trip of the sim state.
- `npm run invcheck`: the pack, consumables, quest items, the bag-to-pack save migration and determinism.
- `npm run playcheck`, `npm run play-headless`, `npm run agent`, `npm run mcp`: the agent player (see below).
- `npm run localcheck`: the local agent runner against a mock Ollama (see "Model providers"), and runner
  pacing (turns per game hour on a quiet world, a notification starts a turn at once, the failure stop, a lazy
  model re-prompted and stopped, the scripted takeover of an idle hero).
- `npm run openaicheck`: the OpenAI provider against a mock OpenAI server (adapter, relay, agent loop, runner).
- `npm run fellowship`, `npm run tablecheck`: the Fellowship played by agents, and Table mode (see below).
- `npm run movecheck`: class abilities (#81): `src/data/moves.js` MOVES/PASSIVES (3 active abilities with a cooldown in seconds and in rounds, 2 passives per class), the one resolver `useMove` in `src/sim/moves.js` for real-time and Table rounds, timed effects and passives in `src/sim/eff.js`, the `use_ability` agent tool, and the Abilities block (`src/ui/abilities.js`) on the Stats tab and Fellowship sheet.
- `npm run setupcheck`, `npm run setupsmoke`: the New World setup (`src/sim/setup.js`, `src/ui/setup.js`, #133): New world opens a page to choose the Fellowship (class, name, people, mind per place) and the DM, then builds the world seeded (`init({setup})`) with agent members agent-played from the first tick and starts their runners through the relay.
- `start-eldmoor.cmd` (Windows, double-click): starts the relay with app runners on and the dev server in two
  windows through `npm.cmd` (PowerShell's execution policy never matters) and opens the game.
- `npm run runnercheck`: app runners (start/stop from the page, refusals, a mock Ollama runner end to end) and
  the relay's Anthropic concurrency queue (mock 429 provider).
- `npm run dm`, `npm run dmcheck`: the DM as an agent (see "DM agent").
- `npm run channelcheck`: the in-game channels rule (see "In-game channels").
- `npm run behavior-report`, `npm run behaviorcheck`: behavior logs for review (see "Behavior logs").

## Agent player

AI agents can play heroes end to end (issues #75, #93), several side by side, one agent per
hero: each looks around, walks, fights, takes adventures, answers scene choices and keeps a
journal, through MCP tools (the list is `src/data/player-tools.js`; the game side is
`src/sim/player.js`). The hero stays a hero: one life, sight limits, the same dice; reflexes
(defend, flee below 15% HP, go home with a full bag) keep it alive while the agent thinks or
is silent, and scene choices time out to the scripted branch, so the world never waits.

- With the browser: `npm run relay` (or `npm run relay -- --play-only` without a key),
  `npm run dev`, select a hero and press **Agent** on its card, for as many heroes as you
  like (the page connects to `ws://127.0.0.1:8787/play` and serves them all; the Agent tab
  shows tool calls, narration, the journal and the agent's link). Then one terminal per hero:
  `npm run agent -- --hero <name|id>` (Claude Agent SDK, `claude-sonnet-5-5` by default,
  `AGENT_MODEL` to change; `--max-turns 20 --budget 1.00` are the default caps per runner;
  cost line per turn). Without `--hero` the runner lists the agent-played heroes and takes
  the first living one with no runner, or says none is free.
- Pacing (issue #126, `scripts/pacing.mjs`, game side `src/sim/pace.js`): turns follow the game, not a
  stopwatch. Between turns a runner long-polls `POST /play/pace` (not a tool; it never consumes the hero's
  events or counts as link activity). A turn starts at once when something cannot wait (attacked, badly
  hurt, a choice, a table scene, a camp alarm: events marked `urgent=2` in `src/sim/notify.js`); once the
  minimum gap has passed (`--min-gap S`, default 20 real seconds) when the hero has unread news (an arrival,
  a vote, a party line, the narrator, an NPC); else after a heartbeat of game time (`--heartbeat MIN`,
  default 240 game minutes). A quiet hero takes about one turn a real minute at 1x and at most one per
  gap plus the turn at 8x; a paused world takes none; at most 2 immediate turns a real minute inside the gap.
  The runner stops when the hero dies or leaves agent play, and after `--max-fails N` (default 5) failed or
  empty turns in a row. Env: `AGENT_HEARTBEAT`, `AGENT_MIN_GAP`, `AGENT_MAX_FAILS`. An older relay or page
  without `/play/pace` falls back to real time as if at 1x. A local (Ollama) runner has no turn cap unless
  `--max-turns` is given (it runs until stopped); Claude and OpenAI keep 20 turns and the budget.
- Autopilot: an agent-played hero with no command and no action that went through for `PK.IDLE` (120)
  game minutes, outside an adventure or a scene, carries on for its agent (`a.playIdle`, "autopilot: ..." in
  the Agent tab, with "Last agent order: N game min ago"): rest when hurt, hunt again when its last order was
  a hunt, follow the party, fight back, go home when hurt or full. The agent stays the mind; nothing is ever
  handed to the scripted rules, and any command takes over again.
- One mind per hero: an agent-played hero has no relay brain (Fellowship Minds: agents turns the members'
  brains off; the relay still writes their sheets) and voices no scripted line (no barks, banter, camp lines,
  quarrel replies or table lines; a silent agent's table reflex acts without a word). Its own lines (say,
  party_say, a table line) show "AGENT · <runner model>" in the Chat tab. Agents speak only English: the
  game refuses a say/party_say that is mostly non-Latin script.
- Hearing: a line from an agent-played hero (aloud in earshot, or on the party channel) starts each listening
  agent's turn at once, at most once per `PK.HEAR_WAKE` (15) game minutes per listener; narrator, NPC and
  scripted party lines wake after the gap. When every member at a Fellowship camp is agent-played, the agents
  are told the fire is lit and talk if they like.
- Headless: `npm run play-headless -- --warm 20 --agents 2` (a Node world on port 8789 with
  the top Concord and Warband heroes agent-played, or `--hero Ann,Bo`; saved to
  `logs/agent-world.json`, `--resume` to continue), then in two terminals
  `npm run agent -- --url http://127.0.0.1:8789 --hero <first>` and `... --hero <second>`.
- One runner per hero: a runner claims its hero at the relay (`POST /play/claim`, refreshed
  every 10 s, released on exit; a second runner for a held hero is refused) and names it on
  every call (`X-Eldmoor-Hero: <id>` on the MCP connection, `hero` on `/play/*`), so its tools
  only touch that hero. Link state per hero, in the Agent tab and the Minds panel:
  **connected** (calling tools), **waiting** (a runner holds it but is thinking or between
  turns), **no runner**.
- Sessions: one file per hero, `logs/agents/<heroId>.json` (gitignored), with the Agent SDK
  session id, system prompt, turns, cost and the hero's runner settings (`runner: {provider,
  model, effort}`, default `anthropic` + `claude-sonnet-5-5`; flags override, then saved, then
  env), so each hero can keep its own mind; `anthropic` (Agent SDK) and `ollama` (a local model,
  see "Model providers") and `openai` run today; the relay routes by hero id only. The next run for that hero resumes it. Runners
  never write another hero's file. A file whose hero name no longer matches (a new world
  reused the id) and the old session on `--new` are moved to `logs/agents/old/`, never
  overwritten. The single `logs/agent-session.json` of #75 migrates on first run.
- Other MCP clients: streamable HTTP at `http://127.0.0.1:8787/mcp` (or `:8789/mcp`
  headless), stateless, POST only, with the `X-Eldmoor-Hero` header or `?hero=<id>` (plus `X-Eldmoor-Runner` for a claimed hero); or stdio
  with `npm run -s mcp` (forwards to `PLAY_URL`, `PLAY_HERO=<id>` picks the hero). Plain JSON
  without MCP: `POST /play/call {tool, args, hero}`; `GET /play/health` lists the agent heroes
  and their links. A call that names no hero goes to the first living agent hero (the old
  single-hero path). Only localhost, no browser origins.
- From the app (no terminal per hero): run the relay with `--runners` (`npm run relay -- --runners`,
  `RELAY_RUNNERS=1`, or `start-eldmoor.cmd`). Then an agent-played hero's mind row, its Agent tab and its
  party frame have **Start runner / Stop runner** with the runner's state (starting, live, waiting,
  stopping, stopped, crashed with its last error line), provider/model, turns and cost; the Fellowship panel
  (Minds: agents) has **Start all five / Stop all** (one `scripts/fellowship.mjs`). A picker chooses the mind
  it starts with (the hero's saved mind, Claude Haiku, Claude Sonnet, or a pulled local model; a runner started from the
  app plays Claude Haiku when nothing is saved, `APP_CLAUDE_MODEL` in `scripts/runners.mjs`, while terminal runners keep
  Sonnet; `AGENT_MODEL`/`DM_MODEL` override both) and its turn cap ("until stopped"
  for a local mind by default, or 5-200 turns). The state line shows turns per minute, the last turn's age
  and the cap; its tooltip shows what the pacing waits for. The relay spawns the runners as
  child processes (`scripts/runners.mjs`: `GET /play/runner`, `POST /play/runner/start {kind:'hero'|'fellowship'|'dm',
  hero?, provider?, model?, maxTurns?, budget?}`, `POST /play/runner/stop {kind, hero?}`; kinds are a table; `dm` runs
  `scripts/dm-agent.mjs`, one at most, and is refused as "not installed yet" until that file exists), `node` with an argument array, never a shell; output in `logs/runners/<key>.log`;
  a stop writes "stop" on the child's stdin (it releases its heroes), then kills; a child also stops when
  the relay goes away. Limits: off without the flag, loopback and the game page's origin only, heroes the
  page names as agent-played, providers anthropic/ollama/openai, defaults 20 turns/$1.00 per hero and 6 turns
  each/$2.00 for the Fellowship (caps 200/$5, 100/$10; local runners have no budget and no turn cap unless
  asked, OpenAI runners keep the budget and take no Claude slot), at most `RELAY_MAX_RUNNERS` (default 6)
  runners, where the six seats (the five Fellowship members as hero runners or one Fellowship runner, plus
  the DM) always fit whatever the caps. Claude slots: at most `RUNNER_CLAUDE_MAX` (default 3, at least 1)
  Claude turns at once across the runners; each supervised Claude turn leases a slot (`POST
  /play/runner/slot`, released after the turn, freed when the child exits) and waits for one when all are
  taken, so starting is never refused for slots (a Fellowship runner also queues its members with
  `--claude-concurrency`). Without `--runners` the buttons say how to turn it on.
- Relay concurrency: the owner's API org caps concurrent requests across all models. The relay keeps at most
  `RELAY_ANTHROPIC_CONCURRENCY` (default 2) Anthropic calls in flight (`scripts/providers/limiter.mjs`):
  decisions queue ahead of writing kinds and are dropped when their deadline passes in the queue (the sim
  plays them scripted); a 429 pauses the queue (retry-after, else backoff) and only writing kinds retry.
  `/health` shows `queues.anthropic` (depth, in flight, 429s, dropped). Keep `RELAY_ANTHROPIC_CONCURRENCY +
  RUNNER_CLAUDE_MAX` within the org's limit; with a very low limit, play runners with local models.
- Memories (#155, `src/sim/notebook.js`): every agent hero keeps its own searchable notes with `remember {title,
  text, tags[], about?}`, `recall {query?, tag?, about?, id?, n?}` (title and tag words 3, about 2, text 1, +1 pinned,
  plus recency; a tag or about filters), `update_memory`, `forget` and `pin`; 200 notes of 600 characters, the oldest
  unpinned is archived (40 kept, still found), 20 pins, 60 writes a game day. Saved with the world on the hero
  (`a.memories`); each turn's state header names the 3 most relevant (people in sight and the party, region, town,
  foe, adventure, an open scene or vote) by id and title only. Hardcore: they die with the hero; in the Fellowship a
  pinned note tagged `letter` is found by whoever takes the fallen member's place, nothing else. The DM has the same
  tools over its four note sections (search across them; `dm_status.relevant_notes`). Mirrored read-only as Markdown
  by the relay (from the page) or the headless world: `logs/agents/<world>/<heroId>-<name>/memory/` (`MEMORY.md`
  plus `<id>-<slug>.md` with front matter), the DM under `dm/memory/`; never read back. `--no-mirror` (or
  `RELAY_MIRROR=0`) turns the files off. The Memory tab and the DM panel's **Notes** filter show them.
- `npm run playcheck`: a scripted mock agent plays through town, a job, a choice, a fight,
  the journal and a save/restore, proves a silent agent never stalls the world, and runs two
  mock agents on two heroes at once (routing, claims, links, the browser bridge, per-hero
  session files). The mock agent's waits drive game time, so it depends on the seed only.

## Fellowship (agents and Table mode)

The Fellowship (#68) is five heroes (Tank, Healer, three DPS) who are the story. Its panel's
**Minds** button cycles scripted -> relay -> agents. With **agents** every member is
agent-played (a replacement after a death is too) and `npm run fellowship` plays all five,
one Agent SDK session per member.

- Browser: `npm run relay` (the brain relay, port 8787; it also serves the agents' MCP tools),
  `npm run dev` (5173), found a Fellowship, set Minds to agents, then
  `npm run fellowship -- --max-turns 6 --budget 2.00`.
- Headless: `node scripts/play-headless.mjs --fellowship --port 8790 --warm 20 [--no-relay]`
  then `npm run fellowship -- --url http://127.0.0.1:8790 --max-turns 2 --budget 0.50`.
- The runner reuses the per-hero sessions (`logs/agents/<heroId>.json`, resumed next run,
  `--new` to start over), runner settings and claims of `npm run agent`; one overall
  `--budget` (for paid members), `--max-turns` per member (default 6 for Claude/OpenAI members, none for local
  ones), each member paced like a hero runner (`--heartbeat MIN`, `--min-gap S`, the old `--cadence S` is the
  gap; a scene starts the member's turn at once), `--follower-model claude-haiku-5-5` for members other
  than the leader between scenes. Combined log `logs/fellowship.log`, per-run cost per member
  in `logs/fellowship-runs.jsonl`.
- Party tools (`src/data/player-tools.js`, `src/sim/council.js`): `party_say`/`party_read`
  (party channel, Chat tab and bubble), `propose`/`vote` (job, crypt, raid, split, other; the
  leader settles it: majority, leader breaks ties, silent members vote by reflex at the
  timeout), leader-only `lead_to`, `leave_party` (splits off for 6 game hours, costs bonds).
  A Crypt group or raid takes the whole Fellowship or none of it; an agent-played Fellowship
  is asked first (a `crypt`/`raid` proposal).
- Table mode (`src/sim/table.js`, banner `src/ui/table.js`): Crypt entry and inner chamber,
  Kragmaw, elite/named foes, enemy ambushes, a member below 25% HP, DM checks and choice
  scenes on their adventures, and proposals open a scene. At 1x `step()` pauses the world
  (only the scene runs), the DM frames it, members act in initiative order (Reflex with gear)
  with `scene_act`; an agent has `TABLE.turnMs` (7 s) per turn, then its reflex acts; scripted
  members act at once. At 3x/8x scenes resolve instantly with a summary. The View group's
  **Table: Auto/Off** switch (Off = Watch mode) never pauses. `npm run tablecheck` proves a
  silent agent never stalls a scene, votes, `lead_to`, the all-or-none Crypt draft and
  determinism without a Fellowship.

## Model providers (Mixed minds, issue #97)

Each AI-played hero can ask a different model. Part 1 covers single decisions (town plan, crypt
call, fight or flee, say) and the Fellowship writing kinds (persona, backstory, memory); part 2
lets a local model play a hero end to end as an agent (`npm run agent`, `npm run fellowship`).

- Install Ollama (https://ollama.com), then pull a model: `ollama pull qwen2.5:14b` (fits a
  24 GB GPU with room to spare; Mistral Small, Gemma or a Qwen 32B also work). Ollama listens on
  `http://localhost:11434`; set `OLLAMA_URL` in `.env` if it runs elsewhere, `OLLAMA_MODEL` for
  the default model.
- Start the relay as usual (`npm run relay`). No API key is needed for local models; without one
  the relay still starts and only Claude requests fail (those heroes play scripted). On start it
  prints whether Ollama is reachable and which models are pulled; `GET /health` lists the same
  under `providers`.
- Pick a mind per member in the Fellowship panel: each member row has Scripted / AI / Agent, and
  for AI a provider (Claude, Local (Ollama), OpenAI, Google) and a model picked from what the relay
  reports. The setting is `a.brainCfg = {provider, model}` on the hero (same shape as the agent
  runner's `runner` settings), saved with the world; the brain sends it with every request for
  that hero, Fellowship sheets included.
- What to expect: zero cost. Measured on the owner's RTX 4090 with `qwen3.5:4b`: 0.3-0.7 s per
  town plan and about 0.25 s per line once loaded (the first call, which loads the model, took
  about 5 s; the relay keeps it loaded for 30 min); a 14B model will be a few times slower. Local calls get longer timeouts: 8 s per decision, 30 s or more for writing
  (`RELAY_LOCAL_TIMEOUT`, `RELAY_LOCAL_WRITE_TIMEOUT`); the sim waits up to 9 s. Smaller models
  pick legal options (the schema forces that) but reason less well and drift out of voice more.
  Thinking models (qwen3.x) are asked with thinking off, or they spend the budget thinking.
- Every answer is validated the same way as Claude's; a bad, slow or missing answer falls back to
  the scripted rules. The Mind tab, Chat tab and Minds panel tag which model answered
  (for example `qwen2.5:14b · local`), and the relay log and `--verbose` log record provider and model.
- Adapters live in `scripts/providers/` (one interface: `call({system, user, schema, maxTokens,
  model, effort})`; Ollama and OpenAI also have `chat({messages, tools|format})` for the agent loop).
  Google is a stub that reports "not configured" until built.

Local agent runner (part 2):

- One hero: press **Agent** on it (or `play-headless`), then
  `npm run agent -- --hero <name|id> --provider ollama --model qwen2.5:14b`. No key; the settings
  are saved in the hero's session file (`runner: {provider: 'ollama', model}`), so later runs need
  only `--hero`. `--provider anthropic` switches it back to Claude (the Claude session is kept).
- A Fellowship: give each member its runner once with `npm run agent -- --hero X --provider ollama
  --model M --max-turns 1`, or play all five locally with `npm run fellowship -- --provider ollama
  --model qwen2.5:14b`. Mixed Fellowships work: members saved as `ollama` play locally, the others
  through the Agent SDK (they still need `ANTHROPIC_API_KEY`; without one only local members play).
- How it plays: `scripts/local-agent.mjs`, a small tool-calling loop on Ollama's `/api/chat`
  `tools`, through the same game tools as Claude (`/play/call`), with the same system prompt,
  turn prompts, claims, pacing, scene turns and `--max-turns`. Every turn prompt carries a fresh state header
  from the game (`POST /play/pace {brief:true}`: state, doing, HP, place, foe, unread news), a first answer
  without a tool call is re-prompted once ("Act through a tool"), only the latest narration stays in the
  history, and a turn with no tool call, every call rejected, or a narration repeating the last one with no
  world-changing call is an empty turn (it counts toward `--max-fails`). Prompts ask for English; a reply that
  is mostly non-Latin script is re-prompted once in English and otherwise counts as empty (never shown or kept).
  Sampling: temperature 0.6, repeat_penalty 1.15; after two empty turns in a row the next starts from a fresh
  context. `chat()` uses node:http with its own timeout (`OLLAMA_CHAT_TIMEOUT`, 600 s, a clear "busy or
  loading" message instead of undici's 5-minute "fetch failed") and one queue per runner process
  (`OLLAMA_PARALLEL`, default 1: a Fellowship runner's local members take turns). Before every local turn the
  runner checks `/api/ps` and warns when Ollama holds another model (the relay's minds evict it on one GPU);
  with no `--model` given it plays with the model Ollama already holds. The runner state line warns when the
  minds and a runner use different local models. Every call is checked against the
  tool table first (bad names or arguments go back to the model as an error, never to the game).
  A turn ends when the model answers in words, at `--tool-turns`, or right after a `wait` returns
  (one last call without tools asks for the narration; small models rarely stop on their own).
  Models without tool support switch to JSON actions (the tool list in the prompt, replies forced
  into `{tool, args, narration}`), remembered per hero; calls written as text
  (`<tool_call>{...}</tool_call>`) are understood.
- Memory: the conversation is kept in the session file (`local.history`, tool results cut to 400
  characters, oldest whole turns dropped past 24k characters; the journal is the long-term memory).
  Context asked of Ollama: 16384 tokens (`--num-ctx`, `OLLAMA_NUM_CTX`); a different `num_ctx`
  from the relay's decision calls makes Ollama reload the model when both use it.
- Turn line: tool calls, seconds (and seconds in the model), model calls, tokens in/out, `$0 (local)`.
  The claim carries `{provider, model}`, so the mind row's Agent mode, the Agent tab and the Minds
  panel tag the runner (`qwen3.5:4b · local · live`); `/play/health` lists it as `heroes[].runner`.
- Measured live (RTX 4090, `qwen3.5:4b`, thinking off): 0.5-1.5 s per model call alone, about
  6-9 k input tokens per call (tools and history), 6-12 calls and 5-25 s per turn; five Fellowship
  members at once: 1.5-3 s per call (Ollama queues them), 20-40 s per turn. A 4B model plays legal
  moves but loops (re-reads, forgets to wait); expect better from 14B and up.
- `npm run localcheck` (in CI) tests all of it against a mock Ollama: the loop, the JSON fallback,
  the runner end to end on a headless world (claims, tags, session file, resume) and a local
  Fellowship.

### OpenAI (ChatGPT models)

The OpenAI provider (`scripts/providers/openai.mjs`) uses the Chat Completions API with strict
JSON-schema structured output for decisions and writing, and the same tool-calling agent loop as
Ollama (`scripts/local-agent.mjs`) for agent play. It is billed per token by OpenAI.

Owner setup:

1. Create an API key at https://platform.openai.com/api-keys and add credit under Billing. API
   billing is separate from a ChatGPT Plus subscription: Plus does not pay for API calls.
2. Add `OPENAI_API_KEY=sk-...` to `.env` (ignored by version control; only the relay and the agent
   runners read it, never the browser). Optionally `OPENAI_MODEL=<id>` (a default; there is none in
   code) and `OPENAI_BASE_URL` (default `https://api.openai.com/v1`, or any OpenAI-compatible server).
3. Restart the relay (`npm run relay`). `GET /health` now lists OpenAI under `providers` with the chat
   models your key can use; the Fellowship panel's mind row (AI) and the Start runner picker fill from it.
4. Pick **OpenAI** in a member's mind row and choose a model (the row says "pick a model" until you do),
   or play an agent with `npm run agent -- --hero <name|id> --provider openai --model <id>` (saved in the
   hero's session file; later runs need only `--hero`), or `npm run fellowship -- --provider openai --model <id>`.
   Tags read like `gpt-6-luna · openai`.

Notes: the model ids and prices were read from OpenAI's pages on 2026-11-01; pick any model from your
own list. The cheapest current chat model on the pricing page was `gpt-6-luna` ($0.10 in / $0.50 out per
1M tokens, https://developers.openai.com/api/docs/pricing). The price table in `openai.mjs` (`PRICES`,
with its source and date) drives cost; a model not in it reports tokens with cost "unknown" (the turn
line says so; the run budget cannot count it). Cached-input discounts are ignored, so costs are an
upper bound. Every request sends `reasoning_effort: "none"` (Chat Completions supports function calling
on the current reasoning models only with it); a model that rejects the field is asked again without it.
Errors: 401 "bad or missing key", 429 "rate limit" (the relay's limiter queues OpenAI calls,
`RELAY_OPENAI_CONCURRENCY`, default 4, pauses on `retry-after`, drops a late decision and retries writing
kinds; an agent turn waits `retry-after` itself), "out of credit" for `insufficient_quota`, "reply cut
off", "model refused". A failed call means the hero plays scripted. Agent runs report real cost per turn
(`| turn $ | run $ | session $`), stop at `--budget`, and appear in the Start runner picker as
`<model> · openai`. The runner reads the key from its own environment/`.env` like the Claude runner
does, and never prints it. `npm run openaicheck` (in CI) tests all of it against a mock OpenAI server,
with no key and no network.

## DM agent (issue #66, part 1)

An AI agent can sit in the DM seat between scenes: it reads the world, keeps campaign notes and shapes
what comes next through the world levers; the scripted DM keeps running beside it, unchanged. It never
controls a hero and never kills anyone by fiat (no lever touches HP, level or life, and a pull that piles
danger onto a badly hurt Fellowship member out in the field is refused). It can also stage narrated
encounters and speak at their tables (issue #132, below).

- In the game: `npm run relay -- --runners` (or `start-eldmoor.cmd`) and `npm run dev`; open the
  **Dungeon Master** panel and press **Open seat**, pick the mind (Claude or a pulled local model) and
  press **Start DM**. The seat (link, runner mind, runner state and last error) shows there and as the
  DM row of **Minds at play** (Start DM / Stop DM there too). Without `--runners` the button says how to
  turn runners on; from a terminal instead: `npm run dm` (one runner; it claims the seat).
- Headless: `node scripts/play-headless.mjs --dm --agents 0 --port 8789` (no agent hero, the seat open),
  then `npm run dm -- --url http://127.0.0.1:8789`.
- Runner (`scripts/dm-agent.mjs`): Agent SDK with `claude-sonnet-5-5` by default (`DM_MODEL`, `--model`,
  `--effort`), or `--provider ollama --model M` through `scripts/local-agent.mjs`; `--max-turns 12
  --budget 1.00` by default (a local DM runs until stopped); `--cadence evening` (a turn now, then one every game
  evening at 18:00) or `--cadence S` real seconds, never less than `--min-gap S` (20) apart; stops after
  `--max-fails` failed or empty turns in a row; never starts a turn while a Table scene or a party vote is open. One model
  call at a time; a rate limit (429/overloaded) backs off 30 s up to 10 min and retries. Cost line per
  turn. Session `logs/agents/dm.json` (keyed by the world's tag, resumed next run, `--new` sets it aside).
- Tools (`src/data/dm-tools.js`, game side `src/sim/dmagent.js`), over MCP at `/mcp?role=dm` (or the
  `X-Eldmoor-Role: dm` header), plain JSON at `POST /play/dm {tool, args}`: `dm_status`,
  `read_timeline`, `read_chronicle`, `read_dm_log`, `fellowship_view`, `heroes_near`, `npcs`,
  `regions`, `hooks`, `levers`, `notes_read`, `notes_write` (threads, characters, plans, secrets; saved
  with the world in `S.dmAgent`), `pull_lever` (`pull(name, params, {by:'dm-agent', reason})`; at most
  `DMA.PULLS_PER_DAY` 8 a game day on top of each lever's limits; `named_foe` stays the scripted DM's),
  `log_intent`, and its in-game voice `narrate` (`{text, near, radius?}`: heroes near a hero, town,
  region or "x,y", or everyone at the open Table scene, hear it in their Chat tab and the Table banner;
  12 a game day) and `npc_say` (`{npc, text}`: a townsperson or placed person speaks to whoever is within
  earshot; 16 a game day). The seat is claimed like a hero (`POST /play/claim {role:'dm', runner}`); `/play/health`
  reports `dm: {seat, link, claimed, runner}`. The game answers only while its seat is open.
- DM log: the agent's entries carry a **DM AGENT** tag and its reason; the **DM agent** filter shows them.
- Measured live (Sonnet 5.5, effort medium, headless day 4): first turn 15 tool calls, 18 s, $0.056 (notes
  in all four sections, a ruin and a wary hermit, one refused pull it corrected); a quiet turn 3 calls, 8 s, $0.013.
- `npm run dmcheck` (in CI): tools, notes, limits and refusals, save/restore, a silent seat leaves a
  seeded world identical, relay routes and MCP, the browser bridge, and the runner end to end on a mock Ollama.

### Staged scenes and the DM at the table (issue #132)

- `stage_scene {kind, near, frame, title?, cast?, reason}` (`src/sim/staged.js`): `elite` (a named foe built
  from the bestiary at a level bounded by the party's: at most `STAGE.LVL_UP` 2 above its average, asking for
  more than 3 above is refused), `ambush` (a pack of the region's creatures from the encounter builder),
  `meeting` and `social` (a person with a want, placed through `create_npc`), `trap` (hidden; a d20 save, never
  below 10% HP) and `mystery` (a `mark_place` marker; a Lore/Perception roll uncovers `cast.reveal`). `near`:
  "fellowship", a member, "x,y", a place or a region. The cast walks to the member (or waits at the place;
  a trap or a strange place lies just ahead of them) and a Table scene opens when they meet; the frame
  reaches the members as narration. `cast.choices` relabels the legal Table actions only. Refused: more than
  3 a game day, one still pending, an open scene or vote, a fight or trap while a member out in the field is
  below 35% HP, a foe far above the party, a creature not of that region, a town. All of it in the DM log
  with the DM AGENT tag; the banner shows the staged cast.
- At the table: the DM is asked short calls (`table_call` / `table_answer`): voice the person or foe, describe
  each member's act (true to the dice), and pick one complication from a legal set (`none`, `omen`, and per
  kind `falter`/`reinforce`, `rival`, `tremor`). Each call has `TABLE.dmMs` (6 s) at 1x, and only while the
  runner is polling; then the scripted DM fills it, and after 2 misses it fills the rest at once. At 3x/8x
  every slot is scripted and the scene resolves in one step.
- Runner: `npm run dm` answers the calls with a table voice (one structured call each: `claude-haiku-5-5` by
  default, `--table-model`/`DM_TABLE_MODEL`; with Ollama the seat's own model; `--no-table-voice` leaves them to
  the scripted DM). Its cost counts toward `--budget`; a `[table]` line per call.
- `npm run tablecheck` stages every kind with a mock DM (and a silent one, no runner, 3x, a save mid-scene,
  expiry); `npm run dmcheck` covers the refusals and the table voice over `/play/dm`.

## In-game channels (issue #123)

The owner's rule: the DM and the players talk only inside the game. How it holds:

- Heroes hear, they do not read minds. Everything said reaches a hero as a line in its chat buffer
  (`a.chat`): `say` within earshot, the party channel, townsfolk, and the DM's `narrate` / `npc_say`.
  Agents read it with `chat_read` (and `party_read`), and as events ("The narrator: ..."); a brain
  hero's snapshot carries its last heard lines. The Table banner and `tableView` show a narrate line
  sent to the table. Hero tools never answer with DM notes, the DM log, lever reasons, or another
  hero's journal, memories, persona, mind, narration or session; `look` no longer says who is
  agent-played; persona/backstory snapshots list companions by name, class and origin only.
- Relay (`scripts/relay-mcp.mjs`): a claimed hero answers only the runner that claimed it (runners
  send `X-Eldmoor-Runner` / `?runner=` on `/mcp` and `runner` on `/play/*`; anyone else gets 409); a
  held DM seat answers only its runner; `/play/dm` and `/mcp?role=dm` refuse a call that names a hero
  or comes from a runner holding one; `/play/call` and `/play/narrate` refuse the DM role; one runner
  never holds a hero and the DM seat. `/play/narrate` only feeds the watcher's Agent tab. `GET
  /play/runner` gives the runners' output lines only to the page's origin.
- Runners: each member and the DM keep their own session; turn prompts are fixed text and standing
  orders come from the seat's own status; the Fellowship runner shares only game state (`/play/health`:
  ids, names, roles, links). The system prompts say that others are reached only in the game.
- `npm run channelcheck` (in CI) plants unique secrets in DM notes, the DM log, lever reasons, another
  member's journal, memories, persona, mind, narration and session prompt, gathers every hero tool
  result, event, runner prompt and brain snapshot, and fails on any secret; it also proves a narrate
  line reaches members in range (and the table) and not one far away, npc_say reaches earshot, party
  chat reaches every member, and the relay keeps the seats apart.

## Behavior logs (for review)

Issue #129: structured, append-only JSONL for the watcher and the `playtest-reviewer` agent, never read
by any agent, tool or the game. Under `logs/behavior/<world>/` (gitignored; each file rotates at 5 MB,
three old files kept): `<world>` is the world id the page names (`eldmoor`, `stepping`) for the relay,
and `<world id>-headless` for `play-headless` (`--log-world NAME`, `--no-behavior`; the relay:
`--no-behavior` or `RELAY_BEHAVIOR=0`).

- `turns.jsonl`: one line per agent turn of a hero or the DM, sent by the runners (`agent-player`,
  `fellowship`, `dm-agent`; `scripts/behavior-turn.mjs`) to `POST /play/behavior/turn`, accepted only from
  the runner holding that seat: seat, provider/model, turn, wake reason, the state header before (runner)
  and after (game), tool names with ok/error, narration, seconds, tokens, cost, flags (empty, repeat,
  foreign, stale, refused, scene, ...).
- `decisions.jsonl`: `src: relay` one line per `/decide` call (kind, provider, model, status, ms, error);
  `src: game` each hero's Mind entry once settled (outcome applied, late, rejected, offline, superseded).
- `world.jsonl`: a digest every game hour from `src/sim/behavior.js` (read-only, not part of `step()`):
  each Fellowship member's and agent hero's mind, link, state, place, HP, level and idle time; the share
  of game time agent / autopilot / relay mind / scripted; Table scenes and agent vs reflex turns; votes;
  DM lever pulls and refusals by caller; DM log kinds; deaths and causes; chat lines by channel (counts).
  The page sends it over the play bridge (`src/ui/player-bridge.js`, which now also connects while a
  Fellowship has relay minds); `play-headless` writes it directly.
- `anomalies.jsonl`: relay side (`scripts/behavior-log.mjs` `BD`): no tool calls for 3 turns, repeated
  narration, not English, stale claim (a fight narrated while the game says none), every call refused,
  relay failures (5 in 5 min: 429, timeouts, 5xx), two Ollama models at once, request floods. Game side
  (`src/sim/behavior.js` `BW`): idle in one place 2+ game hours outside camp, the same state 6 hours with
  no progress, reflex taking every agent turn of 2 scenes in a row, every agent vote by reflex twice,
  DM levers refused often, a danger lever pulled near a member below 35% HP. One line per kind and seat
  per 5 real minutes (the rest counted as `heldBack`).
- Rules: no keys (key-shaped text is redacted, headers never logged), no tool results, prompts or another
  seat's text in a seat's lines, chat as counts only.
- `npm run behavior-report [-- --world NAME | --all] [--hours N]` writes `logs/behavior/<world>/report.md`:
  top anomalies with counts and examples, per-seat health, model comparison (empty-turn rate, seconds,
  tokens and cost per provider/model, relay failure rates, decision outcomes), the world digests.
- `npm run behaviorcheck` (in CI): mock runners and a timing-out relay produce every anomaly kind above on
  a headless Fellowship of silent agents; asserts they are logged and reported, that a runner cannot write
  another seat's line, keys are redacted, files rotate, the watch leaves the world unchanged, and that a
  real `npm run agent` with a lazy mock Ollama model lands its turns and its stale fight claim.

## Layout

- `index.html`: page shell and side panels. `src/style.css`: dark single-theme
  arcade look; Press Start 2P for labels, VT323 for body text.
- `src/main.js`: browser entry only. Calls `init()`, builds the terrain canvas,
  creates the renderer and panels, runs the frame loop (1 real second at 1x =
  6 game minutes).
- `src/core/rng.js`: random helpers, hash, value noise, fbm.
- `src/world/` (world-builder): `tiles.js` map size, tile ids, speeds;
  `spec.js` the world as data: `ELDMOOR` (size, seeded boundary curves,
  regions with level bands, biomes and masks, the river, towns Highgate
  (Concord) and Grimhold (Warband), landmarks (Kragmaw's lair, the Sunken
  Crypt), roads, lights, spawn exclusions, labels) plus the tiny `TESTWORLD`
  fixture; `gen.js` `buildWorld(spec)` paints biomes, river, town rects,
  landmarks and roads (polylines, or A* `routeRoad` between named endpoints
  that bridges rivers) and derives `ZONES`, `CITY`, `LAIR`, `CRYPT`, the
  `zoneFor` level ladder from region bands, `ZPTS` spawn points, `LIGHTS` and
  `LABELS`; `map.js` builds `ELDMOOR` once and re-exports it under the old
  names (`tiles`, `zone`, `I`, `riverX`, `z2X`, `hoarY`, ...). `npm run
  worldcheck` builds both specs and fails if the Eldmoor map drifts from its
  snapshot hashes.
- `src/data/` (pure tables, no logic): `factions.js` FAC, guild roster, names
  (character-builder); `classes.js` CLS (character-builder); `mobs.js` MOBS and
  COUNTS (creature-designer); `items.js` EPICS, BOSS_EPICS, DG_EPICS, GOODS and
  `price` (creature-designer).
- `src/sim/` (DOM-free; ai-designer owns behaviour, creature-designer owns boss
  numbers): `state.js` the single `S` state object and game clock;
  `chronicle.js` `log(...parts)` and `onLog`; `effects.js` pop/bolt;
  `heroes.js` stat formulas, quests, movement, combat, death and the `updAgent`
  state machine (`town`, `travel`, `hunt`, `fight`, `return`, `ghost`, `duel`,
  `assist`, `dungeon`, `raid`, `dead`); `mobs.js` spawning and mob AI;
  `boss.js` the Kragmaw fight and raid muster; `pvp.js` duels, nemesis hunts,
  assists; `dungeon.js` Sunken Crypt runs; `market.js` auction-house prices; `inv.js` the hero pack `a.inv` (stacks, spare gear, consumables from `USES`, quest items, supplies bought in town, `npm run invcheck`);
  `history.js` `record(a, ...parts)` per-hero event log for the dossier Log tab;
  `levers.js` the DM's world levers: a validated registry (`pull(name, params, {by, reason})`)
  with limits, cooldowns and DM log entries for people, places, danger/cleared areas, region
  conditions, price shocks, hooks and named/custom foes, plus the hooks the world reads them
  through (state on `S.levers`, `S.places`, `S.marks`, `S.conditions`, `S.wanderers`;
  drawn by `src/render/places.js`; `npm run levercheck`);
  `index.js` `init()` and `step(dt)`; `fellowship.js` the Fellowship (#68): five fixed
  roles (Tank, Healer, three DPS), founding, muster, hardcore replacement, campaign log,
  `fellowshipMembers()` in slot order; `persona.js` persona sheets and backstories from
  sim facts (scripted, or enriched once through the relay) and `fellowCard` for prompts;
  `memory.js` per-member recent memories, long-term summary and companion stances;
  `council.js` party chat, proposals and votes, `lead_to`, splitting off and the all-or-none
  Crypt/raid draft; `table.js` Table mode scenes; `notify.js` events for agent-played heroes; `dmagent.js` the DM seat and its tools (#66); `staged.js` the DM agent's staged scenes and its at-the-table calls (#132).
- `src/render/`: `sprites.js` pixel-string sprites and `heroSprite`;
  `terrain.js` per-pixel tile textures into an offscreen canvas;
  `draw.js` the camera object `cam`, entities sorted by y, effects, day/night
  overlay with torch light, labels at constant CSS size.
- `src/ui/`: `panels.js` hero card, factions, chronicle, graveyard, guilds,
  top heroes, auction house, clock; `controls.js` speed, view (incl. Follow Fellowship)
  and selection; `fellowship.js` the Fellowship panel (founding, roster, sheet editor,
  campaign log), the Memory tab and the Chronicle's "Fellowship only" filter; `table.js` the
  Table mode banner and the View group's Table switch. Fellowship-first UI (#94):
  `frames.js` party frames above the map, `sheet.js` the side-by-side sheet overlay,
  `layout.js` folds the world panels into a "World" group while a Fellowship exists,
  `mindctl.js` per-member mind control and the Developer toggle (with a Fellowship, AI/Agent
  buttons show only on members unless Developer is on).
- `scripts/headless.mjs`: imports `src/sim/index.js` directly (no DOM stubs),
  steps the world and prints a summary from `S`.

Data flow: sim writes `S` and emits chronicle and market events; render reads
`S` and owns `cam` (view mode and selected hero); UI reads both. `S.pinned` is
the followed hero, whose grave is never recycled. Sim modules never import from
render or ui, so the headless harness stays stub-free.

## Tuning knobs

- XP curve `xpNeed` (60 * l^1.45, times a ramp of +80% from L10 to L16, #107), caution thresholds (hunt retreat at 45% HP, flee at 22%):
  `src/sim/heroes.js`. Hero combat totals (Health, Attack, Defense, Crit, Speed) and their
  level terms: `combatStats` in `src/sim/stats.js`; item armor/damage rates and properties:
  `src/data/items.js`. Class table `CLS`: `src/data/classes.js`.
- Mob stats (`maxhp: 25 + lvl*16`, hit `3 + lvl*2`), aggro and wander: `src/sim/mobs.js`.
- Boss: `maxhp` 9000 in `src/sim/state.js`; hit 55-85 every 1.6s, breath every
  7s, raids need level 14+ heroes, 5+ of them or 4 with average gear 9+; raiders
  break off below 15% HP and a failed raid cools down 240s: `src/sim/boss.js`,
  `RAID_FLEE` in `src/sim/heroes.js`.
- Dungeon success: the `pw` formula in `src/sim/dungeon.js`; a wipe kills 40% of the party (was 55%). Webspinner and Bristleback Boar are softened in `data/bestiary.js` (tilt + aggro); Fellowship replacements seed in `fellowship.js` (`SEED_BEHIND`=2). Duel chance .0375 in `pvp.js`.
- PvP: chance duels 4% x boldness, level gap 2, range 3 tiles; nemesis spot cooldown 45s; guild assist 20%; duellers yield below 30% HP; only fallen heroes of level 12+ pass the grudge to the whole guild (lesser deaths bind their party): `src/sim/pvp.js`, `GUILD_GRUDGE_LVL` in `src/sim/heroes.js`.

## Known state

- In a 120-minute headless run from level 1 (balance #107, 10-run mean): about 21 deaths per hour, ~45% PvP; crypt about 12 deaths and ~50 clears per run; L1-5 mob deaths about 5 (was 16); median living level 11-12, top 18, level 20 not reached by minute 120 in any of 10 runs (first at ~minute 125-140). Median at minute 60 is 11. Kragmaw dies in most runs. Late-game (240 min) PvP among veterans still climbs. Fellowship replacements arrive 2 levels under the lowest living member.
- The world auto-saves to localStorage every game-hour and on tab close, and restores on reload; Export/Import move it as JSON (`src/sim/save.js`, `src/ui/save.js`, `npm run savecheck`).

## Roadmap ideas

1. Done: `main.js` is split into `world`, `data`, `sim`, `render`, `ui` with a
   DOM-free sim core.
2. Done: save and load (localStorage auto-save, JSON export/import).
3. Rebalance hardcore: fewer pointless PvP deaths, a winnable Kragmaw.
4. More world: a second dungeon, rare elite mobs, world events, weather.
5. Smarter AI: parties that quest together, healers following tanks, heroes
   avoiding enemies far above their level, personality traits.
6. Watcher tools: hero biographies, a timeline of notable events, stats charts.
