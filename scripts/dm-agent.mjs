// The DM agent runner (issue #66, part 1): `npm run dm` sits an AI agent in the DM seat. Between
// scenes it reads the world (timeline, chronicle, its DM log, the Fellowship with personas,
// memories and open threads, heroes and parties, people, regions, hooks and levers), keeps its
// campaign notes (saved with the world) and shapes what comes next through the validated world
// levers (pulled with by:'dm-agent': limits, cooldowns and DM log entries apply). It never controls
// a hero and never kills anyone by fiat; the scripted DM keeps running alongside it, unchanged.
//
//   1. npm run relay   (+ npm run dev; in the game open the Dungeon Master panel and press "DM agent")
//      or: node scripts/play-headless.mjs --dm --agents 0   (a Node world with the DM seat open, port 8789)
//   2. npm run dm [-- --url http://127.0.0.1:8789] [--budget 1.00] [--max-turns N] [--cadence evening]
//
// The runner claims the one DM seat at the relay (POST /play/claim {role:'dm'}, refreshed every
// 10 s, released on exit; a second DM runner is refused) and every tool call names the role
// (X-Eldmoor-Role: dm on the MCP connection, POST /play/dm without MCP).
// Cadence: one turn now, then one every game evening (18:00) by default, or every --cadence S real
// seconds; a turn never starts while a Table scene or a party vote is open (that is part 2's at-
// the-table work). One model call at a time (the owner's API concurrency is low); a rate limit (429
// or overloaded) backs off 30 s, 60 s, ... up to 10 min and retries the turn. Turns are also at least
// --min-gap S real seconds apart (issue #126; default 20, AGENT_MIN_GAP), so a fast world (8x: a game day
// in 30 s) gets a DM turn now and then, not back to back. Any DM runs until stopped (a paid one until its
// --budget is spent; #563) unless --max-turns is given; any DM stops after --max-fails N (default 5) failed or empty turns in a row.
// Session: logs/agents/dm.json (gitignored), resumed next run for the same world; --new sets it
// aside in logs/agents/old/. Cost line per turn.
//
// Options: --url (or PLAY_URL; default http://127.0.0.1:8787), --max-turns N (optional; default until stopped), --min-gap S, --max-fails N, --budget USD
// (default 1.00, this run), --cadence evening|S, --tool-turns N (model calls per turn, default 16),
// --provider anthropic|ollama|google (or DM_PROVIDER; google = Gemini through the same tool loop as Ollama, #672), --model (or DM_MODEL; default claude-sonnet-5-5, or the
// Ollama default), --effort (default medium), --ollama-url, --num-ctx, --env FILE, --new.
// --claude-concurrency is accepted (the runner supervisor passes it) and changes nothing: always one call.
// Table voice (issue #132): --table-model (or DM_TABLE_MODEL; default claude-haiku-5-5 with Anthropic, the seat's model with
// Ollama) answers the at-the-table calls of the scenes the DM stages; --no-table-voice leaves them to the scripted DM.
// A table call's cost counts toward --budget and the session, with its own line.
// Talk voice (issue #170): --talk-model (or DM_TALK_MODEL; default the table model) answers the Fellowship's conversations with
// world characters (npc_call -> npc_say {conv} + npc_offer); --no-talk-voice leaves them to DM turns (a waiting conversation then starts
// a turn at once, after the minimum gap) and the scripted DM. --talk-budget S: real seconds the game waits for the talk voice
// per answer (4-30; default 8 with Anthropic, 25 with a local model).
// Ruling voice (issue #522): --ruling-model (or DM_RULING_MODEL; default the table model) rules on the heroes' free actions
// (ruling_call -> ruling_answer: skill, DC word, bounded effects, the line heard); --no-ruling-voice leaves them to the scripted DM.
// --ruling-budget S: real seconds the game waits per ruling (4-30; default 8 with Anthropic, 25 with a local model).
// Companion voice (issue #764): with the talk model, speaks for the scripted companions of agent companies (companion_call ->
// companion_say); --no-companion-voice leaves them to their usual talk; --companion-budget S (default 8 with Anthropic, 25 local).
import {mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join, resolve} from 'node:path';
import {hostname} from 'node:os';
import {DM_TOOLS} from '../src/data/dm-tools.js';
import {withToolMap} from './toolmap.mjs';
import {loadDmSession, saveDmSession, setAsideDm, dmSessionPath, runnerSettings, DEFAULT_PROVIDER} from './agent-sessions.mjs';
import {onSupervisorStop} from './runners.mjs';
import {reportTurn, localRec, turnCollector, usageDelta} from './behavior-turn.mjs'; // behavior logs (issue #129)
import {ctxOf, ctxText, rollDue, rollPoint, rollSession, withCompactWindow, reportThreshold} from './session-roll.mjs'; // sessions kept under the price line (issue #787)
import {paceSettings, turnCap, capText, failTracker, localWorked, takeClaudeSlot} from './pacing.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DM_PROVIDERS = ['anthropic', 'ollama', 'google'];
export const DEFAULT_DM_MODEL = 'claude-sonnet-5-5'; // claude-api skill (cached 2026-10-06): Sonnet 5.5, $2 in / $10 out per 1M tokens
export const EVENING = 18 * 60, DAY = 1440, POLL_MS = 4000, BACKOFF = [30, 60, 120, 240, 600];
// Fellowship-change turns (issue #165): between evenings, a turn is also due when the Fellowship's situation changed (dm_status
// fellowship_change: they arrived or set out, a scene ended, a member fell, an oath or a job finished), at most EVENT_MAX a game
// day and EVENT_GAP game minutes apart, on top of the real-time minimum gap and the Table/vote wait.
export const EVENT_MAX = 3, EVENT_GAP = 120;

// The DM's standing orders: built once per session and kept with it, so a resumed conversation sees the same prompt.
export function dmSystemPrompt(st) {
  const F = st.fellowship;
  return [
    'You are the Dungeon Master of Eldmoor, a small hardcore fantasy world that runs on its own: heroes of two factions quest, trade, feud, run a crypt and raid a wyrm, and die for good. ' +
      (F ? `The story follows ${F.name}, a Fellowship of five (${F.members.filter(m => !m.empty).map(m => m.name + ' the ' + m.role).join(', ')}).` : 'No Fellowship rides yet; watch the world for a story worth telling.'),
    '',
    'Your job in this seat is preparation between scenes, not running them: read what happened, keep your campaign notes, and shape the next stretch of the world so the Fellowship meets interesting choices, recurring faces and consequences of what they did.',
    '',
    'Rules of the seat:',
    '- You act only through your tools. You never control a hero, never decide who lives or dies, and never touch anyone\'s health, level or gear. The dice and the heroes decide; you set the stage.',
    '- Hardcore is sacred: one life. Do not pile danger onto a badly hurt party; give them a road home. Danger should be readable (a rumour, a marked road, a wary innkeeper) before it bites. The heroes know only what they have seen, heard or been told (no levels, no map): a warning spoken in the game (npc_say, narrate) is how they learn that a place or a creature is beyond them.',
    '- Change the world with pull_lever only, with a one-sentence reason (the watcher reads it in the DM log). Few, deliberate pulls: 1-3 a turn is plenty; none is fine when the story is already moving. Levers have limits and cooldowns; a refusal is information, not an error to fight.',
    '- The scripted DM keeps posting jobs and running adventures beside you. Build on what it does; do not flood the boards.',
    '- Keep notes: open threads (unresolved things), characters (recurring people and their wants), plans (what you are setting up), secrets (what the heroes do not know yet). Read them back at the start of a turn and keep them current; they are your memory.',
    DM_MEMORY_ORDERS,
    DM_SIGHT_ORDERS,
    DM_CAMPAIGN_ORDERS,
    DM_WISH_ORDERS,
    '- Use log_intent for one line of what you are preparing and why, when you set something up.',
    '- You speak to the heroes only inside the game: narrate (a line of description the heroes near a place hear and see) and npc_say (a person in the world says something). Your notes, log_intent lines and lever reasons are private to you and the watcher; no hero ever reads them, and you never message a player directly. Speak sparingly: a few lines a day, about what can be seen and heard, never what a hero thinks or must do.',
    '- You may stage a narrated encounter with stage_scene (an elite, an ambush, a meeting, a trap, a mystery or a social scene): for an elite or an ambush call stage_scene with preview "true" first to see the cast the game will build, then write a frame that fits it (a frame of armed men over a pack of boars is refused); you write the frame and the cast, the cast finds the party and a Table scene opens when they meet; the members choose and the dice decide. A meeting or social scene may name a setting (a house, a tavern back room, a chapel, a cellar, an interrogation cell, a shrine, the hold of a ship) and at (a town or a building in it): the Table scene plays in that room; the other kinds play where they happen. A vision (stage_scene kind vision) is an omen or a shared dream with no cast and no dice: near a member or "fellowship" it comes when they next rest, near a place when one of them stands there; you frame it, answer what they ask of it, and cast.reveal, cast.place or cast.creature becomes what they know; use it to plant a thread, a warning or a place to seek. At most one a day is plenty; build it on your threads and notes. Refusals (too soon, too hurt, too strong) are the rules of the seat, not errors to argue with.',
    '- While a scene you staged is at the table, a fast voice of yours answers its calls (voicing the person or foe, describing each action, picking one complication); the same voice frames the opening scene of a new world (session zero) and speaks for a newcomer who arrives to take a fallen member’s place. You do not need to do anything for that.',
    DM_FELLOWSHIP_ORDERS,
    DM_COMPANY_ORDERS,
    DM_EVENT_ORDERS,
    DM_CALL_ORDERS,
    DM_WHEN_ORDERS,
    DM_BETWEEN_ORDERS,
    DM_RENOWN_ORDERS,
    DM_ASK_ORDERS,
    '- If dm_status shows a Table scene or an open vote, read only and end the turn.',
    '- Original world only: invent names in Eldmoor\'s own voice; never borrow names from other games or books.',
    '',
    'Each turn: dm_status (read fellowship_needs first), hear (what they said aloud since you last listened), notes_read, then look where the story is (fellowship_view, read_timeline, read_dm_log, hooks, heroes_near, npcs, regions, levers as needed), update notes, pull at most a few levers, and end with one short sentence of what you prepared.',
  ].join('\n');
}
// Priorities (issue #165): the Fellowship first, then the overall world. The standing-orders line; withDmFellowshipOrders adds it to an older session's prompt.
// A note for the people who build the game (#663): the one line the DM seat carries (the heroes' is WISH_ORDERS in agent-player.mjs).
export const DM_WISH_ORDERS = '- wish {tool, what, why, moment} is for the people who build the game: say which tool you wished you had to tell this story (even one the rules forbid), in English, at most 3 a game day. It is read later, never answered in play; nothing changes this session.';
export const withDmWishOrders = sys => /- wish \{tool, what, why, moment\}/.test(String(sys || '')) ? sys : String(sys || '') + '\n' + DM_WISH_ORDERS;
export const DM_FELLOWSHIP_ORDERS = '- The Fellowship comes first, then the overall world. Every turn starts with them: where they are, their open threads and oaths, pending decisions, their recent scenes, and what would make their next game hours interesting (dm_status fellowship_needs; fellowship_view for the detail). The DM never reads hero notes; you know only what the game shows. An oath is what a hero swore aloud (oaths.sworn); a thread is only offered from their past (oaths.offered): never say they swore it, but a rumour or a person who knew it may put it before them. Put your hooks, rumours, people, places and staged scenes on their road and their threads first. World-shaping that does not touch them comes after, and only when nothing is pending for them; part of each day�s lever and staging limits is kept for the Fellowship, so a refusal that says so is that rule, not an error. A turn also runs when their situation changes (a scene ends, they arrive somewhere, a member falls, an oath is kept), not only on game evenings.';
export const withDmFellowshipOrders = sys => {
  sys = String(sys || ''); if (/\bThe Fellowship comes first\b/.test(sys)) return sys;
  const at = sys.indexOf('\n- If dm_status shows a Table scene');
  return at < 0 ? sys + '\n' + DM_FELLOWSHIP_ORDERS : sys.slice(0, at) + '\n' + DM_FELLOWSHIP_ORDERS + sys.slice(at);
};
// Every company a thread (issue #450, epic #402): agent heroes ride in companies (a solo is a company of one). The line;
// withDmCompanyOrders adds it to an older session's prompt.
export const DM_COMPANY_ORDERS = '- Every company is a thread. When more than one company rides (dm_status companies_needs, companies_view for the detail), serve the company at the head of companies_needs first: the followed company first only when it must choose; then a pending scene or vote; then members badly hurt in the field; then the company longest without you. Then each other company in turn, the one longest without you first, so nobody is starved: a solo\'s road gets a hook before the five get a third. A member who splits off or leaves is a thread of its own, and a solo is the most fragile: size its foes and jobs for one blade.';
export const withDmCompanyOrders = sys => /\bEvery company is a thread\b/.test(String(sys || '')) ? sys : String(sys || '') + '\n' + DM_COMPANY_ORDERS;
// World events (issue #352): festivals, plagues and the rest through start_event, the Fellowship first. withDmEventOrders adds it to an older session's prompt.
export const DM_EVENT_ORDERS = '- World events (start_event: a festival, a plague, and the other kinds dm_status world_events lists) change a whole region for days. The Fellowship comes first here too: consider one only when nothing is pending for them, and only where it fits the region they ride or are headed to (world_events fellowship_regions), so it meets them on their road. One runs at a time and one may start a day; world_events says what is running, whether one may start today and why not. Give the reason the story needs it; the watcher reads it in the DM log, no hero ever does.';
export const withDmEventOrders = sys => /\bWorld events \(start_event\b/.test(String(sys || '')) ? sys : String(sys || '') + '\n' + DM_EVENT_ORDERS;
// Well-formed calls (issue #388, from the behavior logs of 2026-11-02): most of the DM seat's refused calls were missing
// arguments, guessed names and combined places, and staging while the whole Fellowship sat in town. Three lines, one per
// logged problem; withDmCallOrders adds them to an older session's prompt.
export const DM_CALL_ORDERS = [
  '- Send every call whole, the first time. stage_scene needs kind, near, frame and reason (one sentence). For a job, a person or a marker the flat tools are simplest: post_hook {town, tpl, reason}, place_person {role, near, want?, reason}, mark_place {kind, near, reason} (near as for stage_scene). pull_lever takes lever (a name exactly as levers lists it) and params (the parameters levers shows for it): create_npc needs role (peddler, hermit, drover, sellsword, minstrel or stranger) and home, either "town" with town, or "camp" or "road" with at {"x":..,"y":..} on the map and on walkable ground near the Fellowship. A refusal names what is wrong: fix that argument or drop the move; never send the same call again.',
  '- Name places and people exactly. near is one thing: a member\'s name or id, a town, a region, or "x,y" alone, never two together ("Highgate, 10,20" is refused); "fellowship" works for stage_scene, place_person and mark_place, while narrate takes a member\'s name or "table" instead. A landmark such as the Sunken Crypt is not a place name; use its region. npc_say and npc_offer always need npc: the id from npcs, or npc from the place_person (effect.npc from the create_npc pull) that placed them; never a name you made up or wrote differently.',
  '- When the whole Fellowship is in town, stage_scene near "fellowship" is refused (fights, traps and mysteries happen out in the world). A meeting or social scene can still be set there: pass at (their town, or a building in it, such as "the inn in <town>") instead of near, and a setting (house, tavern, chapel, cellar, cell, shrine or hold; dm_status staged.settings lists them); the person waits there and the scene opens in that room. Or speak through a townsperson there (npc_say), place a person in their town, or note the scene in your plans and stage it once they ride out.',
].join('\n');
// What you can do between scenes (issue #636): every lever as a tool, and taking things back. withDmBetweenOrders adds it to an older session's prompt.
export const DM_BETWEEN_ORDERS = [
  '- What you can do between scenes, one tool each (all with a reason; each lever tool counts as a pull with the same limits, cooldowns and Fellowship share as pull_lever, which still works): post_hook or withdraw_hook (jobs on a board), place_person or retire_person (a visitor comes or goes; how says what the town says of them), set_attitude (a person warms or turns on a hero, the Fellowship or a faction), mark_place (a ruin, camp, shrine or tower), mark_danger (an area turns dangerous, or with cleared "yes" quiet), set_condition (bandits, plague, festival, migration, fog over a region), price_shock (a good dearer or cheaper), start_event (a festival, plague, migration or invasion), custom_foe (one special creature near a place), create_site (a dungeon site) and nudge_relation (two parties warm or cool), give_item and take_item (an object changes hands), summon_hero (a background hero of your choosing, a rival or a wanderer, near a place; in a world with no other heroes the roads fill only this way), stage_scene (a narrated encounter), narrate, npc_say, whisper and dream (your voice).',
  '- Take back what you started instead of repeating a refused call: undo reaches your last pull or placement within 3 game hours (a job, person, marker, area, condition, attitude, foe or unopened scene; not items, prices or relations), unstage cancels a staged scene the Table has not opened (the cast walks off), dismiss ends one of your markers or areas early. A refusal that says one staged scene is pending means unstage it or wait; do not ask again. Taking back is logged and capped at 6 a game day.'
].join('\n');
export const withDmBetweenOrders = sys => /\bWhat you can do between scenes\b/.test(String(sys || '')) ? sys : String(sys || '') + '\n' + DM_BETWEEN_ORDERS;
export const withDmCallOrders = sys => /\bSend every call whole\b/.test(String(sys || '')) ? sys : String(sys || '') + '\n' + DM_CALL_ORDERS;
// Deferred actions and chosen wakes (issue #635): one example each; withDmWhenOrders adds the line to an older session's prompt.
export const DM_WHEN_ORDERS = '- You act between your turns with when and watch. when leaves an action behind for a trigger (a hero or company entering a region or town, coming near a place or person, talking to someone, falling below some health, a named foe dying, a job reaching a scene, camp, nightfall, daybreak, an hour, hours passing, a level, an oath kept): for example when {trigger: "enter_region", on: {"region": "Mirefen", "company": "fellowship"}, action: "narrate", args: {"text": "Fog rolls off the black water; somewhere a bell tolls once.", "near": "{who}"}, reason: "the bog announces itself"}. It runs through the same tool when it fires, so limits and refusals apply then; whens lists them, unwhen cancels. watch chooses what wakes you early: watch {trigger: "talks_to", on: {"npc": "Mara"}, note: "she knows of the stolen seal"} starts your next turn when a hero talks to her, and the turn prompt says so. Set a few that serve your plans; at most 6 of each.';
export const withDmWhenOrders = sys => /\byou act between your turns with when and watch\b/i.test(String(sys || '')) ? sys : String(sys || '') + '\n' + DM_WHEN_ORDERS;
// Searchable notes (issue #155): the DM's standing-orders line; withDmMemoryOrders adds it to an older session's prompt.
export const DM_MEMORY_ORDERS = '- Your notes are searchable: remember anything you want to find again, free-form (your own title, text and tags; about and section optional), recall by words, tag, about or id across all sections before you build on a person, place or thread, update_memory, forget, and pin the few that must never be archived. dm_status lists the notes that bear on the moment.';
// Campaign seed: the notes start from the world's campaign file (docs/campaigns/<world>.md).
// What the DM sees of the companies' life (#558): hear first, then the views; survey before placing; world_standing for the wider turns.
export const DM_SIGHT_ORDERS = '- Listen before you act: dm_status unheard counts the lines the companies said aloud since your last hear; read hear first (what they plan, fear, ask for, joke about), then the views. fellowship_view, companies_view and heroes_near show what members carry (quest items, potions, gold), the quests they hold and what they know (carries, quests, knows): build on those, do not hand them what they already hold or warn them of what they know. A quiet turn is: hear, then one act or nothing. Before you place anything, survey {near} gives roads, landmarks and legal x,y spots that mark_place, place_person and stage_scene accept; a refusal about the ground means survey. world_standing is one read of the wider world (guild focus, rivalries, the wyrm, the Crypt, prices, conditions, the top heroes) for the turns after the companies have been served. You hear only what is said aloud in the world, never a journal, memories or thoughts.';
// Asking a company (#826): the world never does, the DM may. withDmAskOrders adds it to an older session's prompt.
export const DM_ASK_ORDERS = '- The world never asks a company to the Crypt or a raid; they go when they choose to. You may ask, as a deliberate act: call_to {kind: crypt|raid, company, by, text, reason} has a person near the leader (or the narrator) put it to them in the game. A company votes, a hero alone answers aloud; the answer is theirs, a no stands for 2 game days, and you ask at most once a game day. Ask when it serves their story, not to fill their day; fellowship_needs and companies_needs tell you what gathers and how your last call went (last_call).';
export const withDmAskOrders = sys => /\bcall_to \{kind: crypt\|raid/.test(String(sys || '')) ? sys : String(sys || '') + '\n' + DM_ASK_ORDERS;
// Word in town and names for deeds (#637, #638): seed_rumour and bestow. withDmRenownOrders adds it to an older session's prompt.
export const DM_RENOWN_ORDERS = '- While you are away, the town can still speak for you: seed_rumour {town or region, text, about, days, reason} gives the innkeeper, gate captain and bard word to pass on for 1-5 days, in their own words, to heroes who talk to them or read the gate board; about is the place, creature or person it points at (they learn of it). Use it to put a lead or a warning on a company’s road before you sleep. After a deed worth a song, bestow {hero, title, why, by} gives the hero a name ("Wightbane", "of the Ford"), proclaimed by a person near them or the narrator; one at a time, sparingly, never a number. A hero who refuses the name aloud keeps no other from you.';
export const withDmRenownOrders = sys => /\bseed_rumour \{town or region/.test(String(sys || '')) ? sys : String(sys || '') + '\n' + DM_RENOWN_ORDERS;
export const withDmSightOrders = sys => /\bListen before you act\b/.test(String(sys || '')) ? sys : String(sys || '') + '\n' + DM_SIGHT_ORDERS;
export const DM_CAMPAIGN_ORDERS = '- Your notes start with a campaign seed (premise, threads, characters, plans, secrets): a starting point to adapt to the Fellowship, not a script; reveal it only through play. dm_status campaign says whether one was loaded.';
export const withDmCampaignOrders = sys => /\bcampaign seed\b/.test(String(sys || '')) ? sys : String(sys || '') + '\n' + DM_CAMPAIGN_ORDERS;
export const withDmMemoryOrders = sys => /\bYour notes are searchable\b/.test(String(sys || '')) ? sys : String(sys || '') + '\n' + DM_MEMORY_ORDERS;
const notesNow = st => st && Array.isArray(st.relevant_notes) && st.relevant_notes.length ? ` Notes that may matter now: ${st.relevant_notes.map(x => `#${x.id} "${String(x.title || '').slice(0, 80)}"`).join(', ')} (recall {id}).` : '';
const heardNote = st => st && st.unheard && st.unheard.total ? ` ${st.unheard.total} line${st.unheard.total === 1 ? '' : 's'} said aloud wait for you: read hear first.` : ' Nothing new was said aloud; a quiet turn is hear, then one act or nothing.';
// The first turn after a roll (#787): the DM's memory is in the game, so it re-reads it. The notes are the campaign; a hero's journal is not the DM's to read.
export const DM_RESUME = ' You are picking up after a pause, with no memory of this conversation: start with notes_read and read_dm_log, to recall what you have set in motion.';
export const dmTurnPrompt = (turns, st) => turns === 0
  ? 'You take the DM seat. Orient yourself: dm_status, hear, fellowship_view, notes_read, levers, read_timeline. Write your first notes (threads, characters, plans), then make at most two changes to the world if they serve the story.'
  : `Day ${st.day}, ${st.time} (${st.part}). ${fellowNow(st)}${st.since_last_look ? `Since your last look: ${st.since_last_look.timeline} timeline events, ${st.since_last_look.dm_log} DM log entries.` : ''} Prepare the next stretch of the campaign, the Fellowship first.${heardNote(st)}${notesNow(st)}`;
// Each turn starts with the Fellowship (issue #165): the status line and the first needs, then the wider world only if nothing is pending for them.
export const fellowNow = st => {const n = st && st.fellowship_needs; if (!n) return companiesNow(st); return `Fellowship first: ${n.summary} ${(n.items || []).slice(0, 3).join(' ')} ${n.quiet ? 'Nothing is pending for them, so the wider world may have a turn after you have given them something to ride toward.' : 'Settle what is pending for them before you touch the wider world.'} `.replace(/\s+/g, ' ').trim() + ' ' + companiesNow(st)};
// Every company a thread (#450): when other companies ride, the turn prompt names them neediest first (at most four) and why.
export const companiesNow = st => {const L = st && Array.isArray(st.companies_needs) ? st.companies_needs : []; if (!L.length) return '';
  const top = L[0], first = (top.items || []).slice(0, 2).join(' ');
  return `Companies, neediest first: ${L.slice(0, 4).map(c => `${c.company} (${c.why}; ${c.summary.replace(/\.$/, '')})`).join('; ')}. Start with ${top.company}${first ? ': ' + first : '.'} `.replace(/\s+/g, ' ').trim() + ' '};
// Is a Fellowship-change turn due before the next evening? last: {sig, gm} of the previous turn; ev: {day, n} (mutated by noteEvent).
// A watch of the DM's own (issue #635) that tripped since the last turn is due the same way: dm_status watches_fired items
// with a hit id above last.watch (the newest the last turn saw). The fixed fellowship_change signature stays the floor.
export const newWatches = (st, seen) => (st && Array.isArray(st.watches_fired) ? st.watches_fired : []).filter(w => w && w.id > (seen || 0));
export const newFired = (st, seen) => (st && Array.isArray(st.fired) ? st.fired : []).filter(f => f && f.seq > (seen || 0));
export const eventDue = (st, last, ev) => !!(st && st.ok && last && last.gm != null && st.gameMin - last.gm >= EVENT_GAP && !(ev && ev.day === st.day && ev.n >= EVENT_MAX)
  && (st.fellowship_change && last.sig != null && st.fellowship_change !== last.sig || newWatches(st, last.watch).length > 0));
// The turn prompt names what tripped and what fired since the last turn (#635).
export const whenNote = (st, seen = {}) => {const w = newWatches(st, seen.watch), f = newFired(st, seen.fired); let s = '';
  if (w.length) s += ` Your watch fired: ${w.map(x => `${x.what} (watch ${x.watch}, day ${x.day} ${x.t}${x.note ? '; your note: ' + x.note : ''})`).join('; ')}.`;
  if (f.length) s += ` Your whens since the last turn: ${f.map(x => `when ${x.id} (${x.trigger}): ${x.tool} ${x.status}${x.why ? ' - ' + x.why : ''}`).join('; ')}.`;
  return s};
export const seenMax = (L, k) => (Array.isArray(L) ? L : []).reduce((m, x) => Math.max(m, Number(x && x[k]) || 0), 0);
export const noteEvent = (ev, st) => {if (ev.day !== st.day) {ev.day = st.day; ev.n = 0} ev.n++};

const post = (base, path, body, ms) => fetch(base + path, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body), signal: AbortSignal.timeout(ms)});
// Every DM call names the role and this runner (the id it claimed the seat with), issue #123.
let RUNNER = null;
export async function dmTool(base, tool, args = {}) {try {return await (await post(base, '/play/dm', {tool, args, role: 'dm', runner: RUNNER}, 20000 + (Number(args && args.wait_ms) || 0))).json()} catch (e) {return {ok: false, error: e.message, offline: true}}}
const short = (v, n = 160) => {const s = typeof v === 'string' ? v : JSON.stringify(v); return s.length > n ? s.slice(0, n) + '…' : s};
const money = v => '$' + (v || 0).toFixed(4);
const sleep = ms => new Promise(r => setTimeout(r, ms));
// The game minute a turn may start after, for a cadence: the next evening, or null (real seconds).
export const nextEvening = gm => {const d = Math.floor(gm / DAY), e = d * DAY + EVENING; return gm < e ? e : e + DAY};
export const isRateLimit = s => /\b429\b|rate.?limit|overloaded|\b529\b/i.test(String(s || ''));

// ---- the table voice (issue #132) ----
// While a scene the DM agent staged is at the table, the game puts short calls to the DM (table_call): voice the
// person or foe, describe a member's action, pick one complication from a legal set. Each has a few seconds
// (TABLE.dmMs, 6 s) before the scripted DM fills it, far too short for an agent turn, so this loop answers them
// with one structured model call each (Haiku 5.5 by default for Anthropic, the seat's own model for Ollama) and
// table_answer. It polls the table cheaply (no model) every POLL_IDLE ms, every POLL_HOT ms while a staged scene
// waits or runs. A late, failed or refused answer changes nothing: the scripted DM already has the slot.
export const DEFAULT_TABLE_MODEL = 'claude-haiku-5-5'; // claude-api skill (cached 2026-10-06): Haiku 5.5, $0.10 in / $0.50 out per 1M tokens
export const POLL_IDLE = 2500, POLL_HOT = 400;
// Long polls (#680): each voice asks with {wait_ms: VOICE_WAIT_MS}; the host holds the request until a call waits (it learns of
// it within ~150 ms) and the game starts the call's budget when the voice first reads it. So a voice makes about 3 polls a real
// minute while idle, not 25-150. A host that answers at once (an older one, a closed seat, a test's in-process tool) falls back
// to sleeping pollIdle/pollHot between polls.
export const VOICE_WAIT_MS = 20000;
// After a poll: sleep only when it came back early without a call (the host did not hold it).
const pollRest = (t0, waitMs) => waitMs > 0 && Date.now() - t0 >= Math.min(waitMs / 2, 1000);
export const TABLE_SYSTEM = 'You are the Dungeon Master\'s voice at the table in Eldmoor, a hardcore fantasy world (original setting; no names from other games or books). ' +
  'A scene is being played: one you staged, the opening of the campaign (session zero: frame it as the company first sits down), a newcomer’s arrival (voice the newcomer), or a company’s talk round its camp fire (frame the night and open the talk on the topic given; never speak for the heroes), or a hero going down (describe the downing, a death save or its end, true to the dice given). Each request is one call: frame the scene, voice a person or creature (one line they say or do), describe what a hero\'s action looks like (one line, true to the dice result given), or pick one complication from the legal list (plus one line of what the heroes notice). ' +
  'Write what can be seen, heard or smelled, as much as the moment needs; usually a few vivid sentences. The Cast line is the truth: voice and describe only what it lists, and invent no one else (no men, bandits or leaders when the cast is creatures). Never decide what a hero thinks, chooses or feels, never change a result the dice gave, never kill or save anyone. Reply as JSON {"text": "...", "pick": "..."}; pick is "" unless the call is a complication.';
export function tablePrompt(t) {
  const c = t.call, s = t.scene || {};
  return [`Scene: ${s.title || '?'} (${s.kind || '?'})`, s.frame ? `It began: ${s.frame}` : '', s.cast && s.cast.length ? `Cast: ${s.cast.join('; ')}` : '',
    s.order && s.order.length ? `At the table: ${s.order.join(', ')}` : '', s.so_far && s.so_far.length ? `So far: ${s.so_far.join(' | ')}` : '', s.said && s.said.length ? `Already said: ${s.said.join(' | ')}` : '',
    `Call ${c.id} (${c.kind}${c.who ? ', ' + c.who : ''}): ${c.about}`, c.legal ? `Legal picks: ${c.legal.join(', ')}` : ''].filter(Boolean).join('\n');
}
export const tableSchema = c => ({type: 'object', properties: {text: {type: 'string'}, pick: {type: 'string', enum: c.legal ? c.legal.slice() : ['']}}, required: ['text', 'pick'], additionalProperties: false});
// adapter: a scripts/providers adapter ({call({system,user,schema,maxTokens,model,effort,timeoutMs})}). Returns {stop()}.
export function tableVoice({base, adapter, model, effort = 'low', log = () => {}, onCost = () => {}, stopped = () => false, tool = dmTool, pollIdle = POLL_IDLE, pollHot = POLL_HOT, waitMs = VOICE_WAIT_MS}) {
  let done = false, seen = 0;
  const loop = async () => {
    while (!done && !stopped()) {
      const p0 = Date.now(), t = await tool(base, 'table_call', waitMs > 0 ? {wait_ms: waitMs} : {});
      const hot = !!(t && t.ok && (t.scene || t.staged));
      if (t && t.ok && t.call && t.call.id !== seen && t.call.seconds_left > .8) {
        seen = t.call.id; const c = t.call, t0 = Date.now();
        try {
          const ms = Math.max(800, c.seconds_left * 1000 - 400); // past the call's budget the answer is worthless: abort it (the Ollama adapter honours only the signal)
          const r = await adapter.call({system: TABLE_SYSTEM, user: tablePrompt(t), schema: tableSchema(c), maxTokens: 800, model, effort, timeoutMs: ms, signal: AbortSignal.timeout(ms)});
          let j = null; try {j = JSON.parse(r.text)} catch {}
          onCost(r.usage || {});
          if (!j || typeof j.text !== 'string') log(`[table] call ${c.id} ${c.kind}: the model's reply was not JSON; the scripted DM fills it`);
          else {
            const a = await tool(base, 'table_answer', {call: c.id, text: j.text, ...(c.legal ? {pick: j.pick} : {})});
            log(`[table] call ${c.id} ${c.kind}${a.pick ? ' ' + a.pick : ''}: ${a.ok ? '"' + short(a.said || '', 140) + '"' : 'x ' + short(a.error, 100)} | ${((Date.now() - t0) / 1000).toFixed(1)} s, ${r.usage ? r.usage.in + ' in / ' + r.usage.out + ' out, ' + money(r.usage.cost) : ''}`);
          }
        } catch (e) {log(`[table] call ${c.id} ${c.kind}: ${short(String(e && e.message || e), 100)} after ${((Date.now() - t0) / 1000).toFixed(1)} s; the scripted DM fills it`)}
        continue;
      }
      if (t && t.ok && pollRest(p0, waitMs)) continue; // a held long poll came back empty: ask again at once
      await sleep(hot ? pollHot : pollIdle);
    }
  };
  const p = loop().catch(e => log(`[table] voice stopped: ${short(String(e && e.message || e), 120)}`));
  return {stop: () => {done = true; return p}};
}

// ---- the talk voice (issue #170) ----
// When a Fellowship member talks to a world character, the game puts a must-answer call to the DM (npc_call): the person,
// what they want and know, their record of the Fellowship, the member's line and the conversation so far. The game waits
// a few seconds (CONV.VOICE_MS, 8 s) while this loop is polling, then the scripted DM answers from the person's role. Like
// the table voice: one structured model call per exchange (Haiku 5.5 by default, the seat's model with Ollama), then
// npc_say {conv} and at most one npc_offer. A late, failed or refused answer changes nothing: the scripted DM has it.
export const TALK_POLL_IDLE = 1500, TALK_POLL_HOT = 400;
export const TALK_SYSTEM = 'You are the Dungeon Master of Eldmoor, a hardcore fantasy world (original setting; no names from other games or books), voicing one of its people. ' +
  'A hero of the Fellowship is talking to them. Answer as that person, in their own voice, as much as the moment needs (usually a few sentences), true to their role, mood, what they want and what they know. ' +
  'You may add one follow-up from the legal list: trade (they open their stock), rumour (a lead the hero can act on: put it in about, and a region name if it has a place), job (work posted for the hero), combat (they turn hostile; only when the hero truly provoked it), blessing (priests and hermits), leave (they end it), or none. ' +
  'Most answers need none; a merchant asked about goods trades, a worried person may give a rumour or a job. Never decide what the hero thinks or does. ' +
  'warmth is how this line changes their feeling for the Fellowship (-1, 0 or 1; -3 or 3 for something big). remember is a short note for their own record (a promise, a debt) or "". ' +
  'Reply as JSON {"text": "...", "offer": "...", "about": "...", "region": "...", "warmth": "0", "remember": ""}.';
export function talkPrompt(c) {
  const n = c.npc || {}, m = c.member || {};
  return [`You are ${n.name} (${n.role}, ${n.faction}, in ${n.where}). You want: ${n.want}. Your mood toward the Fellowship: ${n.mood}${n.warmth != null ? ' (warmth ' + n.warmth + ')' : ''}.`,
    n.knows && n.knows.length ? `You know: ${n.knows.join(' | ')}` : '', n.record && n.record.notes && n.record.notes.length ? `Your record of them: ${n.record.notes.join(' | ')}` : '',
    m.name ? `Speaking to you: ${m.name}, a level ${m.lvl} ${m.cls}${m.role ? ' (' + m.role + ')' : ''} of the Fellowship.` : '',
    c.so_far && c.so_far.length ? `So far: ${c.so_far.join(' | ')}` : '', `Exchange ${c.exchange}. ${m.name || 'They'} says: "${c.line}"`,
    `Legal follow-ups: ${(c.offers || []).join(', ')}, none${c.offered_this_exchange ? ' (one already given this exchange: use none)' : ''}.`].filter(Boolean).join('\n');
}
export const talkSchema = c => ({type: 'object', properties: {text: {type: 'string'}, offer: {type: 'string', enum: [...(c.offered_this_exchange ? [] : c.offers || []), 'none']},
  about: {type: 'string'}, region: {type: 'string'}, warmth: {type: 'string', enum: ['-3', '-1', '0', '1', '3']}, remember: {type: 'string'}}, required: ['text', 'offer', 'about', 'region', 'warmth', 'remember'], additionalProperties: false});
// budgetS: the real seconds the game should wait for this voice per answer (npc_call {budget_s}); a local model needs more than Haiku.
export function talkVoice({base, adapter, model, effort = 'low', log = () => {}, onCost = () => {}, stopped = () => false, tool = dmTool, pollIdle = TALK_POLL_IDLE, pollHot = TALK_POLL_HOT, budgetS = 8, waitMs = VOICE_WAIT_MS}) {
  let done = false, seen = 0;
  const loop = async () => {
    while (!done && !stopped()) {
      const p0 = Date.now(), t = await tool(base, 'npc_call', {budget_s: budgetS, ...(waitMs > 0 ? {wait_ms: waitMs} : {})});
      const c = t && t.ok && t.call;
      if (c && c.call !== seen && c.seconds_left > .8) {
        seen = c.call; const t0 = Date.now(), who = c.npc && c.npc.id;
        try {
          const ms = Math.max(800, c.seconds_left * 1000 - 400);
          const r = await adapter.call({system: TALK_SYSTEM, user: talkPrompt(c), schema: talkSchema(c), maxTokens: 800, model, effort, timeoutMs: ms, signal: AbortSignal.timeout(ms)});
          let j = null; try {j = JSON.parse(r.text)} catch {}
          onCost(r.usage || {});
          if (!j || typeof j.text !== 'string' || !j.text.trim()) log(`[talk] conv ${c.conv}: the model's reply was not usable; the scripted DM answers`);
          else {
            const said = await tool(base, 'npc_say', {npc: String(who), conv: c.conv, text: j.text, ...(Number(j.warmth) ? {warmth: Number(j.warmth)} : {}), ...(j.remember ? {remember: j.remember} : {})});
            let off = null;
            if (said.ok && j.offer && j.offer !== 'none') off = await tool(base, 'npc_offer', {npc: String(who), conv: c.conv, kind: j.offer, ...(j.about ? {about: j.about} : {}), ...(j.region ? {region: j.region} : {})});
            log(`[talk] ${c.npc.name} to ${c.member ? c.member.name : '?'}: ${said.ok ? '"' + short(j.text, 140) + '"' : 'x ' + short(said.error, 100)}${off ? (off.ok ? ' ' + off.mark : ' (' + j.offer + ' refused: ' + short(off.error, 80) + ')') : ''} | ${((Date.now() - t0) / 1000).toFixed(1)} s${r.usage ? ', ' + r.usage.in + ' in / ' + r.usage.out + ' out, ' + money(r.usage.cost) : ''}`);
          }
        } catch (e) {log(`[talk] conv ${c.conv}: ${short(String(e && e.message || e), 100)} after ${((Date.now() - t0) / 1000).toFixed(1)} s; the scripted DM answers`)}
        continue;
      }
      if (t && t.ok && pollRest(p0, waitMs)) continue; // a held long poll came back empty: ask again at once
      await sleep(t && t.ok && t.open && t.open.length ? pollHot : pollIdle);
    }
  };
  const p = loop().catch(e => log(`[talk] voice stopped: ${short(String(e && e.message || e), 120)}`));
  return {stop: () => {done = true; return p}};
}
// ---- the companion voice (issue #764) ----
// A scripted hero riding with an agent company (a hire, a companion) speaks through the DM: the game puts a call (companion_call)
// with its card, the day, what it heard and what it already said to each listener; one structured model call per line (the talk
// model), then companion_say. A late, failed or refused answer changes nothing: its usual talk fills it, never repeating a row.
export const COMP_POLL_IDLE = 1500, COMP_POLL_HOT = 400;
export const COMP_SYSTEM = 'You are the Dungeon Master of Eldmoor, a hardcore fantasy world (original setting; no names from other games or books), voicing a companion who rides with a company of heroes, like a companion played by the DM at a tabletop game. ' +
  'Say one or two sentences as that companion, in their own voice: true to their card (class, home, traits, oath, how they ride), to what the company did today and to what was just said. ' +
  'Never repeat or rephrase a line they already said to that listener (you_said_to_them); say something new. Never put words in a hero\'s mouth, decide what a hero thinks or does, or quote a hero. Speak English, plainly, no stage directions. ' +
  'Reply as JSON {"text": "..."}.';
export function compPrompt(c) {
  const p = c.companion || {}, w = c.their_words;
  const why = c.trigger === 'camp' ? `It is night at the camp fire in ${c.where}; the talk turns to ${c.topic || 'whatever is on their mind'}.`
    : c.trigger === 'quarrel' ? `At the fire in ${c.where}, someone just snapped at them; they answer back.`
    : `In ${c.where}, a hero speaks to them and they answer.`;
  return [`You are ${p.name}, a level ${p.level} ${p.cls}${p.race ? ' (' + p.race + ')' : ''} from ${p.home || 'somewhere'}${p.origin ? ', ' + p.origin : ''}. You ride with ${p.company || 'a company'}: ${p.rides}.`,
    p.traits && p.traits.length ? `Your traits: ${p.traits.join(', ')}.` : '', p.oath ? `Your oath: ${p.oath}.` : '',
    ['voice', 'wants', 'fears', 'quirk', 'never_says', 'backstory'].filter(k => p[k]).map(k => `${k.replace('_', ' ')}: ${p[k]}`).join(' | '),
    `Time ${c.time}. ${why}`,
    c.today && c.today.length ? `Today the company: ${c.today.join(' | ')}` : 'Nothing much happened today.',
    c.heard && c.heard.length ? `Lately you heard: ${c.heard.join(' | ')}` : '',
    ...(c.listeners || []).map(l => `${l.name} (${l.cls}, level ${l.level}) hears you.${l.you_said_to_them && l.you_said_to_them.length ? ' You already said to them: ' + l.you_said_to_them.join(' | ') : ''}`),
    w ? `${w.from} ${w.how}: "${w.text}"` : ''].filter(Boolean).join('\n');
}
export const compSchema = () => ({type: 'object', properties: {text: {type: 'string'}}, required: ['text'], additionalProperties: false});
export function companionVoice({base, adapter, model, effort = 'low', log = () => {}, onCost = () => {}, stopped = () => false, tool = dmTool, pollIdle = COMP_POLL_IDLE, pollHot = COMP_POLL_HOT, budgetS = 8, waitMs = VOICE_WAIT_MS}) {
  let done = false, seen = 0;
  const loop = async () => {
    while (!done && !stopped()) {
      const p0 = Date.now(), t = await tool(base, 'companion_call', {budget_s: budgetS, ...(waitMs > 0 ? {wait_ms: waitMs} : {})});
      const c = t && t.ok && t.call;
      if (c && c.call !== seen && c.seconds_left > .8) {
        seen = c.call; const t0 = Date.now(), who = c.companion && c.companion.name;
        try {
          const ms = Math.max(800, c.seconds_left * 1000 - 400);
          const r = await adapter.call({system: COMP_SYSTEM, user: compPrompt(c), schema: compSchema(c), maxTokens: 300, model, effort, timeoutMs: ms, signal: AbortSignal.timeout(ms)});
          let j = null; try {j = JSON.parse(r.text)} catch {}
          onCost(r.usage || {});
          if (!j || typeof j.text !== 'string' || !j.text.trim()) log(`[companion] call ${c.call}: the model's reply was not usable; the usual talk fills it`);
          else {
            const said = await tool(base, 'companion_say', {call: c.call, text: j.text.trim()});
            log(`[companion] ${who} (${c.trigger}): ${said.ok ? '"' + short(said.said || j.text, 140) + '"' : 'x ' + short(said.error, 100)} | ${((Date.now() - t0) / 1000).toFixed(1)} s${r.usage ? ', ' + r.usage.in + ' in / ' + r.usage.out + ' out, ' + money(r.usage.cost) : ''}`);
          }
        } catch (e) {log(`[companion] call ${c.call}: ${short(String(e && e.message || e), 100)} after ${((Date.now() - t0) / 1000).toFixed(1)} s; the usual talk fills it`)}
        continue;
      }
      if (t && t.ok && pollRest(p0, waitMs)) continue;
      await sleep(pollIdle);
    }
  };
  const p = loop().catch(e => log(`[companion] voice stopped: ${short(String(e && e.message || e), 120)}`));
  return {stop: () => {done = true; return p}};
}
// ---- the ruling voice (issue #522) ----
// A hero tries something the tools never named (attempt; scene_act attempt at the table). The game asks the DM for a ruling
// (ruling_call): the hero in words, the attempt, the place and what is in sight, the legal skills, DCs and effect forms. It waits
// a few seconds while this loop polls, then the scripted DM rules. One forced structured answer per call (enums for skill, DC and
// effect kinds), then ruling_answer; a refused answer (an illegal effect) is logged and the scripted DM rules at the deadline.
export const RULING_POLL_IDLE = 1500, RULING_POLL_HOT = 400;
export const RULING_SYSTEM = 'You are the Dungeon Master of Eldmoor, a hardcore fantasy world (original setting; no names from other games or books), ruling on what a hero tries. ' +
  'The hero may try anything; you decide which skill it tests and how hard it is (easy 8, fair 12, hard 15, heroic 18), and what follows a success and a failure, drawn only from the legal effects. ' +
  'The game rolls the dice; you never decide the result, what a hero thinks or chooses, and never touch level, XP, gold or life (a wound is at most 15% and never below 10% HP). ' +
  'Most attempts deserve none or one small effect: a clever idea a reveal (a fact they learn, a place, a creature) or someone warming to them, a reckless one a small wound or exposed. ' +
  'text is what the heroes hear on a success and fail_text on a failure (vivid, as much as the moment needs, usually one to three sentences, true to what is in sight). ' +
  'An effect is {kind, target, value}: move {target: a direction or "x,y"}, reveal {target: place|fact|creature, value: the name or the fact}, attitude {target: a person in sight, value: -3..3}, open_talk {target: a person}, ' +
  'open_scene {target: mystery|meeting|social|ambush|trap}, item {target: give|take, value: the item}, wound {target: 1..15}, condition {target: warded|exposed, value: minutes}, boon {target: d4|d6|d8}, none. ' +
  'Reply as JSON {"skill": "...", "dc": "...", "effects": [...], "fail_effects": [...], "text": "...", "fail_text": "...", "note": "..."}; note is for your own log.';
export function rulingPrompt(c) {
  const h = c.hero || {}, w = c.where || {}, s = c.in_sight || {}, t = c.attempt || {};
  return [`Hero: ${h.name}, a ${h.cls}, ${h.level}, ${h.health}. Best skills: ${(h.best_skills || []).join(', ')}.${h.gear && h.gear.length ? ' Gear: ' + h.gear.join(', ') + '.' : ''}${h.quest_items && h.quest_items.length ? ' Carries: ' + h.quest_items.join(', ') + '.' : ''}`,
    `Where: ${w.region || 'the wilds'}${w.town ? ' (in town)' : ''} at ${w.x},${w.y}${w.table_scene ? '; at the table: ' + w.table_scene : ''}.`,
    s.creatures && s.creatures.length ? `Creatures in sight: ${s.creatures.join(', ')}` : '', s.people && s.people.length ? `People near: ${s.people.map(p => p.name + (p.role ? ' (' + p.role + ')' : '')).join(', ')}` : '',
    s.heroes && s.heroes.length ? `Heroes near: ${s.heroes.join(', ')}` : '', s.places && s.places.length ? `Places near: ${s.places.join(', ')}` : '',
    `${h.name} tries: "${t.what}"${t.how ? ' (how: ' + t.how + ')' : ''}${t.at ? ' (at: ' + t.at + ')' : ''}`,
    `Legal effects: ${((c.legal || {}).effects || []).join(', ')}. Forms: ${((c.legal || {}).effect_forms || []).join('; ')}`].filter(Boolean).join('\n');
}
const EFFECT = kinds => ({type: 'object', properties: {kind: {type: 'string', enum: kinds}, target: {type: 'string'}, value: {type: 'string'}}, required: ['kind', 'target', 'value'], additionalProperties: false});
export const rulingSchema = c => {const L = c.legal || {}, kinds = (L.effects || ['none']).slice();
  return {type: 'object', properties: {skill: {type: 'string', enum: (L.skills || []).slice()}, dc: {type: 'string', enum: Object.keys(L.dc || {easy: 1, fair: 1, hard: 1, heroic: 1})},
    effects: {type: 'array', items: EFFECT(kinds)}, fail_effects: {type: 'array', items: EFFECT(kinds)}, text: {type: 'string'}, fail_text: {type: 'string'}, note: {type: 'string'}},
  required: ['skill', 'dc', 'effects', 'fail_effects', 'text', 'fail_text', 'note'], additionalProperties: false}};
// {kind, target, value} -> the game's "kind:target:value" form (empty parts dropped); "none" entries dropped unless alone.
export const effectText = e => e && typeof e === 'object' ? [e.kind, e.target, e.value].map(x => String(x == null ? '' : x).trim()).filter((x, i) => i === 0 || x).join(':') : String(e || '');
export const effectList = L => {const a = (Array.isArray(L) ? L : []).slice(0, 3).map(effectText).filter(Boolean), b = a.filter(x => x !== 'none'); return b.length ? b : a.slice(0, 1)};
export function rulingVoice({base, adapter, model, effort = 'low', log = () => {}, onCost = () => {}, stopped = () => false, tool = dmTool, pollIdle = RULING_POLL_IDLE, pollHot = RULING_POLL_HOT, budgetS = 8, waitMs = VOICE_WAIT_MS}) {
  let done = false, seen = 0;
  const loop = async () => {
    while (!done && !stopped()) {
      const p0 = Date.now(), t = await tool(base, 'ruling_call', {budget_s: budgetS, ...(waitMs > 0 ? {wait_ms: waitMs} : {})});
      const c = t && t.ok && t.call;
      if (c && c.call !== seen && c.seconds_left > .8) {
        seen = c.call; const t0 = Date.now();
        try {
          const ms = Math.max(800, c.seconds_left * 1000 - 400);
          const r = await adapter.call({system: RULING_SYSTEM, user: rulingPrompt(c), schema: rulingSchema(c), maxTokens: 800, model, effort, timeoutMs: ms, signal: AbortSignal.timeout(ms)});
          let j = null; try {j = JSON.parse(r.text)} catch {}
          onCost(r.usage || {});
          if (!j || typeof j.text !== 'string' || !j.text.trim()) log(`[ruling] call ${c.call}: the model's reply was not usable; the scripted DM rules`);
          else {
            const a = await tool(base, 'ruling_answer', {call: c.call, skill: j.skill, dc: j.dc, effects: effectList(j.effects), fail_effects: effectList(j.fail_effects), text: j.text, fail_text: j.fail_text || '', note: j.note || ''});
            log(`[ruling] ${c.hero ? c.hero.name : '?'} "${short(c.attempt && c.attempt.what || '', 60)}": ${j.skill} ${j.dc} -> ${a.ok ? (a.outcome || 'ruled') + (a.roll ? ' (' + a.roll + ')' : '') : 'x ' + short(a.error, 100)} | ${((Date.now() - t0) / 1000).toFixed(1)} s${r.usage ? ', ' + r.usage.in + ' in / ' + r.usage.out + ' out, ' + money(r.usage.cost) : ''}`);
          }
        } catch (e) {log(`[ruling] call ${c.call}: ${short(String(e && e.message || e), 100)} after ${((Date.now() - t0) / 1000).toFixed(1)} s; the scripted DM rules`)}
        continue;
      }
      if (t && t.ok && pollRest(p0, waitMs)) continue; // a held long poll came back empty: ask again at once
      await sleep(t && t.ok && t.waiting ? pollHot : pollIdle);
    }
  };
  const p = loop().catch(e => log(`[ruling] voice stopped: ${short(String(e && e.message || e), 120)}`));
  return {stop: () => {done = true; return p}};
}
// A conversation waiting for the DM while no talk voice runs: the turn starts at once and its prompt names it (#170).
export const talkWaiting = st => st && Array.isArray(st.conversations) ? st.conversations.filter(c => c.waiting) : [];
export const talkNote = st => {const w = talkWaiting(st); return w.length ? ` A Fellowship member is talking to someone and waits for an answer: ${w.map(c => `${c.member} to ${c.npc} (conv ${c.conv}): "${c.line}"`).join('; ')}. First answer as that person: npc_call, then npc_say {npc, conv, text} and at most one npc_offer; then go on with your turn.` : ''};

// ---- the prep before the table opens (issue #437, owner decision of 2026-11-03) ----
// When every seat is ready, the host holds the world while the DM takes one bounded prep turn (sim/prep.js: about 90 s and
// 20 tool calls; half on Continue or for a DM runner started again mid-session). A fresh runner waits for the host to start
// it (dm_status prep.state 'running'): as long as session zero is due (prep.opening_due), else PREP_WAIT_MS. The turn has
// the prep's call cap as its model-call cap and is aborted at its time cap; then the runner calls prep_done (a cap the game
// counted may already have ended it) and the opening scene opens; the table voice frames it.
export const PREP_WAIT_MS = 15000;
export const prepPrompt = st => {const p = st.prep || {}, cap = `at most ${p.max_calls || 20} tool calls and ${p.max_seconds || 90} seconds`;
  return p.kind === 'opening'
    ? `Session zero. The world is paused before the first table opens, and this one turn is your preparation (${cap}). ${fellowNow(st)}Read: dm_status, notes_read (your campaign seed: premise, threads, characters, plans and opening beats), fellowship_view. Write your plans for the first days (remember or notes_write). Mark one place or post one hook for the opening, on the company's road (mark_place or post_hook), and log_intent one line. Then call prep_done. Nothing of this reaches a hero except through the opening scene, which you will frame when it opens.`
    : `The world is paused for a short prep before the clock runs again (${cap}): re-read where the companies are (dm_status, fellowship_view, notes_read), bring your plans up to date, then call prep_done.`};
export async function waitPrep({base, log = () => {}, stopped = () => false, tool = dmTool, waitMs = PREP_WAIT_MS, every = 1000}) {
  const t0 = Date.now(); let said = false;
  for (;;) {
    if (stopped()) return null;
    const st = await tool(base, 'dm_status'), p = st && st.ok ? st.prep : null;
    if (p && p.state === 'running') return st;
    if (!(p && p.host)) return null; // nobody holds the world for a prep (an older page, play-headless without --wait-ready)
    if (!(p && p.opening_due) && Date.now() - t0 >= waitMs) return null;
    if (p && p.opening_due && !said) {said = true; log('[dm] session zero is due: waiting for every seat to be ready, then the prep')}
    await sleep(every);
  }
}

// Wait until the cadence allows a turn and nothing is pending. Returns the fresh status, or null on stop.
// gapUntil: the earliest real time (ms) the next turn may start (the minimum gap, issue #126).
async function waitTurn({base, cadence, lastGm, lastSig = null, lastWatch = 0, ev = {day: -1, n: 0}, log, stopped, gapUntil = 0, talkNow = false}) {
  const target = cadence === 'evening' && lastGm != null ? nextEvening(lastGm) : null, until = Math.max(gapUntil, cadence !== 'evening' && lastGm != null ? Date.now() + Number(cadence) * 1000 : 0);
  let said = '';
  for (;;) {
    if (stopped()) return null;
    const st = await dmTool(base, 'dm_status');
    let why = '', evt = false;
    if (!st.ok && st.offline && /seat is closed/.test(st.error || '')) why = '[pace] the DM seat is closed (the game opens it when a world is played; the DM is always an agent): waiting'
    else if (!st.ok) why = st.offline ? 'the game is not answering (' + short(st.error, 90) + ')' : short(st.error, 90);
    else if (talkNow && talkWaiting(st).length && !(st.table && st.table.open) && Date.now() >= gapUntil) why = ''; // a member waits for an answer and no talk voice runs (#170)
    else if (target != null && st.gameMin < target && !(evt = eventDue(st, {sig: lastSig, gm: lastGm, watch: lastWatch}, ev))) why = `waiting for the evening of day ${Math.floor(target / DAY) + 1} (now day ${st.day} ${st.time})`;
    else if (until && Date.now() < until) why = `next turn in ${Math.ceil((until - Date.now()) / 1000)} s`;
    else if (st.pending) why = st.table && st.table.open ? 'a Table scene is running' : 'a party vote is open';
    if (!why) {if (evt) {noteEvent(ev, st); st.event = true; const w = newWatches(st, lastWatch); log(w.length ? `[dm] your watch fired (${w.map(x => x.what).join('; ')}): an extra turn (${ev.n} of ${EVENT_MAX} today)` : `[dm] the Fellowship's situation changed: an extra turn (${ev.n} of ${EVENT_MAX} today)`)} return st}
    if (why.replace(/\d+/g, '') !== said) {said = why.replace(/\d+/g, ''); log(`[dm] ${why}`)}
    await sleep(POLL_MS);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2);
  const opt = (k, d) => {const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] != null && !argv[i + 1].startsWith('--') ? argv[i + 1] : d};
  const flag = k => argv.includes('--' + k);
  const {loadEnv} = await import('./relay.mjs');
  const envFile = opt('env', null), env = envFile ? loadEnv(dirname(resolve(envFile))) : loadEnv();
  const base = String(opt('url', env.PLAY_URL || 'http://127.0.0.1:8787')).replace(/\/$/, '');
  const turnsAsked = opt('max-turns', null), pace = paceSettings(opt, env), budget = Math.max(.01, Number(opt('budget', 1))), toolTurns = Math.max(2, Number(opt('tool-turns', 16)));
  const cadence = String(opt('cadence', 'evening')); if (cadence !== 'evening' && !(Number(cadence) >= 5)) {console.error('[dm] --cadence is "evening" or a number of real seconds (5 or more).'); process.exit(1)}
  const log = s => console.log(s);

  const health = await fetch(base + '/play/health', {signal: AbortSignal.timeout(5000)}).then(r => r.json()).catch(e => ({error: e.message}));
  if (!health.ok || !health.connected) {console.error(`[dm] The game at ${base} is not ready: ${health.error || 'no game page connected'}. Start the relay (npm run relay) and open the game, or run play-headless --dm.`); process.exit(1)}
  if (!health.dm || !health.dm.seat) {console.error('[dm] The DM seat is closed: no world is played with it open (the page opens it for every world; headless: play-headless --dm).'); process.exit(1)}
  const runner = `${hostname()}:${process.pid}:dm`; RUNNER = runner;
  let mind = {};
  const claim = () => post(base, '/play/claim', {role: 'dm', runner, ...mind}, 5000).then(async r => ({status: r.status, ...(await r.json())})).catch(e => ({status: 0, error: e.message}));
  const c0 = await claim();
  if (c0.status !== 200) {console.error('[dm] ' + (c0.error || 'could not take the DM seat')); process.exit(1)}
  let stopping = false;
  const beat = setInterval(() => claim().then(c => {if (c.status === 409) {console.error('[dm] ' + c.error); process.exit(1)} if (c.status === 404) {console.error('[dm] ' + c.error); stopping = true}}), 10000); beat.unref();
  const release = () => post(base, '/play/release', {role: 'dm', runner}, 3000).catch(() => {});
  let turnAbort = null; // the Agent SDK turn in flight, so a stop ends it (and its subprocess) cleanly
  const quit = async code => {stopping = true; if (turnAbort) turnAbort.abort(); clearInterval(beat); await release(); process.exit(code)};
  process.on('SIGINT', () => quit(130)); process.on('SIGTERM', () => quit(143));
  // Started from the game (scripts/runners.mjs, Start DM): a "stop" on stdin, or the relay going away, ends the run.
  onSupervisorStop(async why => {log(`[dm] ${why}: leaving the DM seat`); await quit(0)});

  const st0 = await dmTool(base, 'dm_status');
  if (!st0.ok) {console.error('[dm] dm_status failed: ' + st0.error); await quit(1)}
  const fresh = () => ({sessionId: null, world: st0.world, system: dmSystemPrompt(st0), turns: 0, costUsd: 0, lastTotal: 0, lastGm: null});
  let {sess, note} = loadDmSession(st0.world, fresh, {startNew: flag('new')});
  // The game clock is behind the saved session: a new world under the same name, or an older save. Set the old
  // session aside (its notes, cadence and conversation belong to another world) and keep only the runner settings.
  if (sess.turns && sess.lastGm != null && Number.isFinite(st0.gameMin) && st0.gameMin < sess.lastGm) {
    const keep = sess.runner; ({sess, note} = loadDmSession(st0.world, fresh, {startNew: true})); if (keep) sess.runner = keep;
    log(`[dm] the game clock is behind this DM's last turn (a new world or an older save): starting a fresh DM session`);
  }
  if (note) log('[dm] ' + note);
  sess.system = withDmAskOrders(withDmRenownOrders(withDmBetweenOrders(withDmWishOrders(withDmWhenOrders(withDmSightOrders(withDmCompanyOrders(withDmCallOrders(withDmEventOrders(withDmCampaignOrders(withDmFellowshipOrders(withDmMemoryOrders(sess.system)))))))))))); // well-formed calls (#388); searchable notes (#155) for a session that began before them
  const {runner: rs} = runnerSettings(sess, {provider: opt('provider', null), model: opt('model', null), effort: opt('effort', null)},
    {provider: env.DM_PROVIDER || DEFAULT_PROVIDER, model: env.DM_MODEL || DEFAULT_DM_MODEL, effort: env.DM_EFFORT || 'medium'});
  sess.system = withToolMap(sess.system, 'dm', rs.provider === 'ollama'); // the tool map (#640), generated from dm-tools.js at each start
  if (!DM_PROVIDERS.includes(rs.provider)) {console.error(`[dm] provider "${rs.provider}" has no DM runner. Use --provider anthropic, ollama or google.`); await quit(1)}
  const saveSess = () => saveDmSession(sess, {url: base});
  let spent = 0, ended = null, runIn = 0, runOut = 0, backoff = 0, lastEnd = 0;
  const maxTurns = turnCap(turnsAsked, rs.provider, 12), fails = failTracker(pace.maxFails), gapUntil = () => lastEnd ? lastEnd + pace.minGap * 1000 : 0;
  const t00 = Date.now();

  if (rs.provider === 'ollama' || rs.provider === 'google') {
    // A local model sits in the seat (Mixed minds): the tool loop of scripts/local-agent.mjs over the DM tools. No key, cost 0.
    // Gemini (#672) plays through the same loop with its own adapter (GOOGLE_API_KEY from this process's .env; free tier cost 0).
    const gem = rs.provider === 'google';
    const {ollamaAdapter, OLLAMA_URL, OLLAMA_MODEL, numCtxFrom} = await import('./providers/ollama.mjs');
    const {localTurn, localLine, paidLine} = await import('./local-agent.mjs');
    let ol = null, spentG = 0;
    if (gem) {
      const {openaiRunner} = await import('./agent-chat.mjs'), o = await openaiRunner(rs, env, {explicit: !!opt('model', null)});
      if (o.error) {console.error('[dm] ' + o.error); await quit(1)}
      if (o.note) log('[dm] ' + o.note);
      ol = o.adapter; sess.runner = rs; mind = {provider: 'google', model: rs.model}; await claim();
      log(`[dm] DM seat taken | model ${rs.model} via Gemini (${ol.tier} tier) | ${sess.local && sess.local.history && sess.local.history.length ? 'resuming' : 'new session'} | ${capText(maxTurns)}, budget ${money(budget)}, cadence ${cadence}, at least ${pace.minGap} s apart`);
    } else {
    if (!opt('model', null) && rs.model && /^claude-/.test(rs.model)) rs.model = null;
    rs.model = rs.model || env.OLLAMA_MODEL || OLLAMA_MODEL; rs.effort = null; sess.runner = rs; mind = {provider: 'ollama', model: rs.model}; await claim();
    ol = ollamaAdapter({url: opt('ollama-url', env.OLLAMA_URL || OLLAMA_URL), defaultModel: rs.model, numCtx: numCtxFrom({OLLAMA_NUM_CTX: opt('num-ctx', env.OLLAMA_NUM_CTX || null)})}); const s0 = await ol.status();
    if (!s0.ok) {console.error(`[dm] Ollama at ${s0.url} is ${s0.error}. Start Ollama or pass --ollama-url.`); await quit(1)}
    if (!s0.models.includes(rs.model)) {console.error(`[dm] model ${rs.model} is not pulled in Ollama (pulled: ${s0.models.join(', ') || 'none'}). Run: ollama pull ${rs.model}, or pick one with --model.`); await quit(1)}
    {const {localModelNote} = await import('./pacing.mjs'); const n = await localModelNote(ol, rs.model); if (n) log('[dm] ' + n)} // another model, or ours at another num_ctx (#221)
    log(`[dm] DM seat taken | local model ${rs.model} via Ollama, num_ctx ${ol.numCtx} | ${sess.local && sess.local.history && sess.local.history.length ? 'resuming' : 'new session'} | ${capText(maxTurns)}, cadence ${cadence}, at least ${pace.minGap} s apart`);
    }
    const where = gem ? ' (Gemini)' : ' (local)', onCost = gem ? u => {const c = u && u.cost || 0; spentG += c; sess.costUsd = (sess.costUsd || 0) + c} : undefined;
    {const {warmUp} = await import('./warmup.mjs'); await warmUp({base, seat: {role: 'dm'}, runner, model: rs.model, adapter: ol, log})} // the start gate (issue #222): ready = answered
    if (!flag('no-table-voice')) {tableVoice({base, adapter: ol, model: rs.model, log, stopped: () => stopping, onCost}); log(`[dm] table voice: ${rs.model}${where} answers the calls of staged scenes`)}
    if (!flag('no-talk-voice')) {talkVoice({base, adapter: ol, model: rs.model, log, stopped: () => stopping, onCost, budgetS: Number(opt('talk-budget', env.DM_TALK_BUDGET || (gem ? 8 : 25)))}); log(`[dm] talk voice: ${rs.model}${where} answers the Fellowship's conversations with world characters`)}
    if (!flag('no-companion-voice')) {companionVoice({base, adapter: ol, model: rs.model, log, stopped: () => stopping, onCost, budgetS: Number(opt('companion-budget', env.DM_COMPANION_BUDGET || (gem ? 8 : 25)))}); log(`[dm] companion voice: ${rs.model}${where} speaks for the scripted companions of agent companies`)}
    if (!flag('no-ruling-voice')) {rulingVoice({base, adapter: ol, model: rs.model, log, stopped: () => stopping, onCost, budgetS: Number(opt('ruling-budget', env.DM_RULING_BUDGET || (gem ? 8 : 25)))}); log(`[dm] ruling voice: ${rs.model}${where} rules on the heroes' free actions`)}
    const rules = '\n\nHow your turns work here: call one tool at a time and read its result before the next. When you are done for this turn, reply with one short sentence of what you prepared, in plain text (no tool call).';
    let prepSt = await waitPrep({base, log, stopped: () => stopping}); // the prep before the table opens (#437)
    if (prepSt) log(`[dm] preparing the table (${prepSt.prep.kind}): at most ${prepSt.prep.max_calls} calls, ${prepSt.prep.max_seconds} s`);
    for (let turn = 1; turn <= maxTurns && !ended; turn++) {
      if (gem && spentG >= budget) {ended = 'budget reached'; break}
      const st = prepSt || await waitTurn({base, cadence, lastGm: sess.turns ? sess.lastGm : null, lastSig: sess.turns ? sess.lastSig : null, lastWatch: sess.lastWatch || 0, ev: sess.ev || (sess.ev = {day: -1, n: 0}), log, stopped: () => stopping, gapUntil: gapUntil(), talkNow: flag('no-talk-voice')}); if (!st) {ended = 'the seat closed'; break}
      let r = null, err = null;
      const prepping = st === prepSt && !!prepSt, prepAt = Date.now();
      {const rd = rollDue(sess, 0, {busy: prepping}); if (rd) {rollSession(sess, setAsideDm); saveSess(); log('  ' + rd.line)}} // only when asked from the page (#787)
      try {r = await localTurn({chat: ol.chat, call: (tool, args) => prepping && Date.now() - prepAt > prepSt.prep.max_seconds * 1000 ? Promise.resolve({ok: false, error: 'The prep time is over: end the turn.'}) : dmTool(base, tool, args), sess, prompt: prepping ? prepPrompt(st) : dmTurnPrompt(sess.turns, st) + talkNote(st) + whenNote(st, {watch: sess.lastWatch, fired: sess.lastFired}), model: rs.model, toolTurns: prepping ? Math.max(2, st.prep.max_calls) : toolTurns, tools: DM_TOOLS, rules,
        // the breaker and the minute cap (issue #467): 3 refusals of one tool or 5 in a row end the turn; at most
        // DM_CALLS_PER_MIN (default 30) tool calls a real minute across turns, well under the relay's flood line (90)
        opts: {endOnWait: false, sameRefusals: 3, consecutiveRefusals: 5, callsPerMin: Math.max(5, Number(opt('calls-per-min', env.DM_CALLS_PER_MIN || 30)) || 30)},
        on: (k, a, b) => {if (k === 'text') log(`  DM: ${a}`); else if (k === 'tool') log(`  > ${a}(${b && Object.keys(b).length ? short(b, 120) : ''})`); else if (k === 'result') log(`    < ${short(a, 220)}`);
          else if (k === 'break') log(`  [breaker] ${a.n} refusals of ${a.tool}${a.inRow > a.n ? ' (' + a.inRow + ' in a row)' : ''}: the turn ends here`); else if (k === 'throttle') log(`  [throttle] ${a} tool calls in the last minute: the turn ends here`)}})}
      catch (e) {err = String(e && e.message || e).split(/\r?\n/)[0].slice(0, 300); console.error(`[dm] turn failed: ${err}`)}
      if (prepping) {const d = await dmTool(base, 'prep_done', {summary: 'prepared the table'}); log(`[dm] prep over: ${d.ok ? (d.prep && d.prep.why) || 'done' : short(d.error, 80)}`); prepSt = null}
      sess.turns++; sess.lastGm = st.gameMin; sess.lastSig = st.fellowship_change == null ? null : st.fellowship_change; lastEnd = Date.now(); sess.lastWatch = Math.max(sess.lastWatch || 0, seenMax(st.watches_fired, 'id')); sess.lastFired = Math.max(sess.lastFired || 0, seenMax(st.fired, 'seq'));
      reportTurn(base, {role: 'dm', runner, provider: rs.provider, model: rs.model, turn: sess.turns, gameMin: st.gameMin ?? null, ...localRec(r), ...(err ? {error: err} : {})});
      if (r && gem) {runIn += r.in; runOut += r.out; spentG += r.cost || 0; sess.costUsd = (sess.costUsd || 0) + (r.cost || 0); log(`[turn ${sess.turns}] ${paidLine(r, rs.model, 'google', {run: spentG, session: sess.costUsd})}`)}
      else if (r) {runIn += r.in; runOut += r.out; log(`[turn ${sess.turns}] ${localLine(r, rs.model)}`)}
      saveSess();
      if (fails.ok(localWorked(r))) ended = fails.why();
    }
    clearInterval(beat); await release();
    log(`[dm] stopped after ${sess.turns} turns this session${ended ? ' (' + ended + ')' : ''}; this run ${runIn} tokens in / ${runOut} out in ${((Date.now() - t00) / 1000).toFixed(0)} s, ${gem ? money(spentG) + ' (Gemini ' + ol.tier + ' tier)' : '$0 (local)'}. Session saved to ${dmSessionPath()}.`);
    process.exit(0);
  }

  if (!env.ANTHROPIC_API_KEY) {console.error('[dm] No ANTHROPIC_API_KEY in the environment or .env (use --env FILE), or play the DM locally with --provider ollama.'); await quit(1)}
  const {query} = await import('@anthropic-ai/claude-agent-sdk');
  let tableCost = 0;
  if (!flag('no-table-voice')) {
    const {default: Anthropic} = await import('@anthropic-ai/sdk'), {anthropicAdapter} = await import('./providers/anthropic.mjs');
    const tableModel = opt('table-model', env.DM_TABLE_MODEL || DEFAULT_TABLE_MODEL);
    tableVoice({base, adapter: anthropicAdapter({client: new Anthropic({apiKey: env.ANTHROPIC_API_KEY}), defaultModel: tableModel}), model: tableModel, log, stopped: () => stopping,
      onCost: u => {const c = u.cost || 0; spent += c; sess.costUsd += c; tableCost += c}});
    log(`[dm] table voice: ${tableModel} answers the calls of staged scenes`);
  }
  if (!flag('no-talk-voice')) {
    const {default: Anthropic} = await import('@anthropic-ai/sdk'), {anthropicAdapter} = await import('./providers/anthropic.mjs');
    const talkModel = opt('talk-model', env.DM_TALK_MODEL || opt('table-model', env.DM_TABLE_MODEL || DEFAULT_TABLE_MODEL));
    talkVoice({base, adapter: anthropicAdapter({client: new Anthropic({apiKey: env.ANTHROPIC_API_KEY}), defaultModel: talkModel}), model: talkModel, log, stopped: () => stopping, budgetS: Number(opt('talk-budget', env.DM_TALK_BUDGET || 8)),
      onCost: u => {const c = u.cost || 0; spent += c; sess.costUsd += c; tableCost += c}});
    log(`[dm] talk voice: ${talkModel} answers the Fellowship's conversations with world characters`);
  }
  if (!flag('no-companion-voice')) {
    const {default: Anthropic} = await import('@anthropic-ai/sdk'), {anthropicAdapter} = await import('./providers/anthropic.mjs');
    const compModel = opt('talk-model', env.DM_TALK_MODEL || opt('table-model', env.DM_TABLE_MODEL || DEFAULT_TABLE_MODEL));
    companionVoice({base, adapter: anthropicAdapter({client: new Anthropic({apiKey: env.ANTHROPIC_API_KEY}), defaultModel: compModel}), model: compModel, log, stopped: () => stopping, budgetS: Number(opt('companion-budget', env.DM_COMPANION_BUDGET || 8)),
      onCost: u => {const c = u.cost || 0; spent += c; sess.costUsd += c; tableCost += c}});
    log(`[dm] companion voice: ${compModel} speaks for the scripted companions of agent companies`);
  }
  if (!flag('no-ruling-voice')) {
    const {default: Anthropic} = await import('@anthropic-ai/sdk'), {anthropicAdapter} = await import('./providers/anthropic.mjs');
    const rulingModel = opt('ruling-model', env.DM_RULING_MODEL || opt('table-model', env.DM_TABLE_MODEL || DEFAULT_TABLE_MODEL));
    rulingVoice({base, adapter: anthropicAdapter({client: new Anthropic({apiKey: env.ANTHROPIC_API_KEY}), defaultModel: rulingModel}), model: rulingModel, log, stopped: () => stopping, budgetS: Number(opt('ruling-budget', env.DM_RULING_BUDGET || 8)),
      onCost: u => {const c = u.cost || 0; spent += c; sess.costUsd += c; tableCost += c}});
    log(`[dm] ruling voice: ${rulingModel} rules on the heroes' free actions`);
  }
  sess.runner = rs; mind = {provider: rs.provider, model: rs.model}; claim();
  const {model, effort} = rs;
  log(`[dm] DM seat taken | model ${model} (effort ${effort}) | ${sess.sessionId ? 'resuming session ' + sess.sessionId : 'new session'} | ${capText(maxTurns)}, budget ${money(budget)}, cadence ${cadence}, at least ${pace.minGap} s apart`);
  const rollAt = rollPoint('dm', model, env); let netSaid = false; // the roll and the compaction net (#787)
  const childEnv = withCompactWindow({...process.env, ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY, CLAUDE_AGENT_SDK_CLIENT_APP: 'eldmoor-dm-agent/1.0'}, rollAt, env);
  delete childEnv.CLAUDECODE; delete childEnv.CLAUDE_CODE_ENTRYPOINT;
  mkdirSync(join(ROOT, 'logs'), {recursive: true}); // the agent's working directory (it has no file tools)
  {const {warmUp, claudeWarmAdapter} = await import('./warmup.mjs'); await claim(); await warmUp({base, seat: {role: 'dm'}, runner, model, adapter: await claudeWarmAdapter(env.ANTHROPIC_API_KEY), log})} // the start gate (issue #222)
  let prepSt = await waitPrep({base, log, stopped: () => stopping}); // the prep before the table opens (#437)
  if (prepSt) log(`[dm] preparing the table (${prepSt.prep.kind}): at most ${prepSt.prep.max_calls} calls, ${prepSt.prep.max_seconds} s`);
  for (let turn = 1; turn <= maxTurns && !ended;) {
    if (spent >= budget) {ended = 'budget reached'; break}
    const st = prepSt || await waitTurn({base, cadence, lastGm: sess.turns ? sess.lastGm : null, lastSig: sess.turns ? sess.lastSig : null, lastWatch: sess.lastWatch || 0, ev: sess.ev || (sess.ev = {day: -1, n: 0}), log, stopped: () => stopping, gapUntil: gapUntil(), talkNow: flag('no-talk-voice')}); if (!st) {ended = 'the seat closed'; break}
    const t0 = Date.now(), tc = turnCollector(); let tools = 0, result = null, limited = false, failed = null;
    const rd = rollDue(sess, rollAt, {busy: st === prepSt && !!prepSt, legacy: /haiku/i.test(model)}); // between turns (waitTurn never returns with a scene or a vote open), never in the prep (#787)
    if (rd) {rollSession(sess, setAsideDm); saveSess(); log('  ' + rd.line)}
    const freeSlot = await takeClaudeSlot(base, log, {stopped: () => stopping}); // under the app supervisor: one of the Claude slots for this turn
    turnAbort = new AbortController();
    const prepping = st === prepSt && !!prepSt, prepTimer = prepping ? setTimeout(() => {if (turnAbort) turnAbort.abort()}, prepSt.prep.max_seconds * 1000) : null;
    const q = query({prompt: prepping ? prepPrompt(st) : dmTurnPrompt(sess.turns, st) + (sess.rolled ? DM_RESUME : '') + talkNote(st) + whenNote(st, {watch: sess.lastWatch, fired: sess.lastFired}), options: {
      abortController: turnAbort,
      model, effort, systemPrompt: sess.system, resume: sess.sessionId || undefined,
      mcpServers: {eldmoor: {type: 'http', url: `${base}/mcp?role=dm&runner=${encodeURIComponent(runner)}`, headers: {'X-Eldmoor-Role': 'dm', 'X-Eldmoor-Runner': runner}, timeout: 30000}},
      tools: [], allowedTools: ['mcp__eldmoor'], permissionMode: 'dontAsk', settingSources: [],
      settings: {autoCompactEnabled: true}, maxTurns: prepping ? Math.max(2, st.prep.max_calls) : toolTurns, maxBudgetUsd: Math.max(.01, budget - spent),
      cwd: join(ROOT, 'logs'), env: childEnv,
    }});
    try {for await (const m of q) {
      if (m.type === 'system' && m.subtype === 'init') {sess.sessionId = m.session_id; if (!prepping) delete sess.rolled; saveSess(); if (!netSaid) {netSaid = true; reportThreshold(q, Number(childEnv.CLAUDE_CODE_AUTO_COMPACT_WINDOW), s => log('  ' + s))}}
      else if (m.type === 'system' && m.subtype === 'api_retry') {if (m.error_status === 429 || m.error === 'rate_limit' || m.error === 'overloaded') {limited = true; log(`  [rate limited: the SDK retries in ${Math.round(m.retry_delay_ms / 1000)} s (attempt ${m.attempt}/${m.max_retries})]`)}}
      else if (m.type === 'system' && m.subtype === 'compact_boundary') {sess.compacts = (sess.compacts || 0) + 1; log(`  [compacted: ${m.compact_metadata.pre_tokens} -> ${m.compact_metadata.post_tokens ?? '?'} tokens]`)}
      else if (m.type === 'assistant' && !m.parent_tool_use_id) {
        sess.ctx = ctxOf(m.message.usage) ?? sess.ctx; // the last call's prompt (#787)
        if (m.error === 'rate_limit' || m.error === 'overloaded') {limited = true; failed = m.error}
        for (const b of m.message.content || []) {
          if (b.type === 'text' && b.text.trim()) {log(`  DM: ${b.text.trim()}`); tc.text(b.text)}
          else if (b.type === 'tool_use') {tools++; tc.tool(b.name, b.id); log(`  > ${String(b.name).replace(/^mcp__eldmoor__/, '')}(${b.input && Object.keys(b.input).length ? short(b.input, 140) : ''})`)}
        }
      } else if (m.type === 'user' && Array.isArray(m.message?.content)) {
        for (const b of m.message.content) if (b.type === 'tool_result') {const c = Array.isArray(b.content) ? b.content.map(x => x.text || '').join('') : String(b.content || ''); log(`    < ${short(c, 220)}`); tc.result(b.tool_use_id, c, b.is_error)}
      } else if (m.type === 'result') result = m;
    }} catch (e) {
      const msg = String(e && e.message || e).split(/\r?\n/)[0].slice(0, 300);
      if (result && result.subtype === 'error_max_turns') log(`[dm] turn hit the ${toolTurns} model-call cap; continuing next turn`);
      else if (isRateLimit(msg) || limited) failed = failed || 'rate_limit';
      else {console.error(`[dm] turn failed: ${msg}`); failed = failed || 'error'}}
    freeSlot(); if (prepTimer) clearTimeout(prepTimer);
    if (prepping) {const d = await dmTool(base, 'prep_done', {summary: 'prepared the table'}); log(`[dm] prep over: ${d.ok ? (d.prep && d.prep.why) || 'done' : short(d.error, 80)}`); prepSt = null; if (failed === 'error' && turnAbort && turnAbort.signal.aborted) failed = null}
    let turnCost = null, tin = null, tout = null, cread = null, cwrite = null;
    if (result) {
      const ud = usageDelta(sess, result); tin = ud.tokensIn; tout = ud.tokensOut; cread = ud.cacheRead; cwrite = ud.cacheWrite; // before the cost baseline moves (#282)
      const tot = result.total_cost_usd || 0, cost = tot >= sess.lastTotal ? tot - sess.lastTotal : tot; sess.lastTotal = tot;
      spent += cost; sess.costUsd += cost; turnCost = cost;
      if (result.is_error && isRateLimit(JSON.stringify(result.errors || result.result || ''))) failed = failed || 'rate_limit';
      log(`[turn ${sess.turns + 1}] ${tools} tool calls, ${((Date.now() - t0) / 1000).toFixed(1)} s, ${result.num_turns} model calls | session tokens this turn: in ${tin ?? '?'} / cache read ${cread ?? '?'} / cache write ${cwrite ?? '?'} / out ${tout ?? '?'} | ${ctxText(sess.ctx)} | turn ${money(cost)} | run ${money(spent)} | session ${money(sess.costUsd)}${result.subtype !== 'success' ? ' | ' + result.subtype : ''}`);
    }
    reportTurn(base, {role: 'dm', runner, provider: rs.provider, model, turn: sess.turns + 1, gameMin: st.gameMin ?? null, tools: tc.tools, narration: tc.narration, seconds: +((Date.now() - t0) / 1000).toFixed(1), tokensIn: tin, tokensOut: tout, cacheRead: cread, cacheWrite: cwrite, cost: turnCost, ...(sess.ctx != null ? {ctx: sess.ctx} : {}),
      flags: [...(rd ? ['session-rolled'] : []), ...(result && result.subtype !== 'success' ? [result.subtype] : [])], ...(failed ? {error: failed === 'rate_limit' || failed === 'overloaded' ? '429 ' + failed : failed} : {})});
    // A rate-limited turn that did nothing is retried after a growing pause; a turn that got work done counts.
    if (failed && failed !== 'error' && !tools) {const s = BACKOFF[Math.min(backoff, BACKOFF.length - 1)]; backoff++; log(`[dm] rate limited (${failed}); backing off ${s} s before trying the turn again`); saveSess(); await sleep(s * 1000); continue}
    backoff = 0; sess.turns++; sess.lastGm = st.gameMin; sess.lastSig = st.fellowship_change == null ? null : st.fellowship_change; turn++; lastEnd = Date.now(); sess.lastWatch = Math.max(sess.lastWatch || 0, seenMax(st.watches_fired, 'id')); sess.lastFired = Math.max(sess.lastFired || 0, seenMax(st.fired, 'seq'));
    saveSess();
    if (fails.ok(!failed && tools > 0)) ended = fails.why();
  }
  clearInterval(beat); await release();
  log(`[dm] stopped after ${sess.turns} turns this session${ended ? ' (' + ended + ')' : ''}; this run ${money(spent)}${tableCost ? ' (table voice ' + money(tableCost) + ')' : ''}, session ${money(sess.costUsd)}, ${sess.rolls || 0} rolls, ${sess.compacts || 0} compactions. Session saved to ${dmSessionPath()}.`);
  process.exit(0);
}
