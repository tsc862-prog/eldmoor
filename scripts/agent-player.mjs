// Agent player runner (issues #75, #93): `npm run agent` plays one agent-played hero with the
// Claude Agent SDK (@anthropic-ai/claude-agent-sdk), connected to the Eldmoor MCP tools. Several
// heroes can be agent-played at once; run one runner per hero, each in its own terminal.
//
//   1. npm run relay   (+ npm run dev, open the game, select heroes, press "Agent" on each)
//      or: npm run play-headless -- --agents 2   (a Node world, no browser; port 8789)
//   2. npm run agent -- --hero <name|id> [--url http://127.0.0.1:8787] [--budget 1.00] [--max-turns N] [--new]
//
// Without --hero the runner lists the agent-played heroes and takes the first living one that has
// no live runner (or says none is free). The runner claims its hero at the relay (POST
// /play/claim, refreshed every 10 s, released on exit), so a second runner for the same hero is
// refused, and every tool call carries the hero id (X-Eldmoor-Hero header on the MCP connection,
// `hero` on /play/*), so its tools only ever touch that hero.
//
// One "turn" here is one query() to the agent: it looks, decides, acts, waits, and ends the turn
// with a line of narration; the runner prints the tool calls, the narration and a cost line.
// Pacing (issue #126, scripts/pacing.mjs): the next turn starts when something happens to the hero
// (attacked, badly hurt, a choice or a scene: at once; an arrival, a vote, a party line, the narrator:
// after the minimum gap) or after a heartbeat of game time (--heartbeat MIN, default 120 game minutes),
// never sooner than --min-gap S real seconds (default 20) except for what cannot wait. A paused world
// takes no turns. The runner stops when the hero dies or leaves agent play, and after --max-fails N
// (default 5) failed or empty turns in a row. Each hero's session id lives in its own file, logs/agents/<heroId>.json
// (gitignored; scripts/agent-sessions.mjs), so the next run for that hero resumes the same
// conversation and no runner ever overwrites another hero's session (--new sets the old one
// aside in logs/agents/old/ and starts afresh). Long sessions compact automatically (the Agent
// SDK's auto-compaction; boundaries are printed).
//
// Options: --hero NAME|ID, --url (or PLAY_URL; default http://127.0.0.1:8787), --max-turns N
// (optional: any mind runs until stopped, a paid one until its --budget is spent; #563), --heartbeat MIN,
// --min-gap S, --max-fails N (or AGENT_HEARTBEAT, AGENT_MIN_GAP, AGENT_MAX_FAILS), --budget USD (default 1.00, total for this run), --tool-turns N (model round
// trips per turn, default 12), --model (or AGENT_MODEL; default claude-sonnet-5-5), --effort (or
// AGENT_EFFORT; default medium), --provider (or AGENT_PROVIDER; 'anthropic', 'ollama' or 'openai'), --env FILE (a .env with ANTHROPIC_API_KEY; default the repo's
// .env), --new.
// Local models (issue #97 part 2): --provider ollama --model qwen2.5:14b plays the hero with a local
// Ollama model through the same tools, claims and session file (scripts/local-agent.mjs; the
// conversation is kept compactly in the session file, trimmed to a budget). No key, cost 0; the
// turn line reports tokens and seconds. --ollama-url (or OLLAMA_URL; default http://localhost:11434),
// --num-ctx N (or OLLAMA_NUM_CTX; context window asked of Ollama, default 16384). The settings are
// saved per hero, so the next `npm run agent -- --hero X` plays it locally again.
// OpenAI (issue #97): --provider openai --model <id> plays through the same loop against OpenAI's Chat
// Completions with real cost (OPENAI_API_KEY from the environment/.env, OPENAI_MODEL a default, OPENAI_BASE_URL
// for a compatible server); --budget caps the run like Claude's.
// The key is read from the environment or the .env file and handed only to the SDK process.
// The agent gets no built-in tools (no files, no shell, no web): only the game's MCP tools.
import {mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join, resolve} from 'node:path';
import {hostname} from 'node:os';
import {query} from '@anthropic-ai/claude-agent-sdk';
import {loadEnv, PRICES} from './relay.mjs';
import {migrateLegacy, loadSession, saveSession, sessionPath, pickHero, runnerSettings, inheritRunner, DEFAULT_PROVIDER, RUNNER_PROVIDERS} from './agent-sessions.mjs';
import {onSupervisorStop} from './runners.mjs';
import {ollamaAdapter, OLLAMA_URL, OLLAMA_MODEL, numCtxFrom} from './providers/ollama.mjs';
import {localTurn, localLine, paidLine, sceneToAnswer, sceneFrom, sceneTurn, chatAsk, adapterAsk, reflectTurn, joinTurns} from './local-agent.mjs';
import {reflectPrompt, reflectNow, closeReflection} from './pacing.mjs'; // reflection moments (#179)
import Anthropic from '@anthropic-ai/sdk';
import {warmUp, claudeWarmAdapter} from './warmup.mjs'; // the start gate (issue #222)
import {anthropicAdapter} from './providers/anthropic.mjs';
import {openaiRunner} from './agent-chat.mjs';
import {withSituationOrders, ORDERS_FULL} from './orders.mjs';
export {withSituationOrders};
import {reportTurn, localRec, turnCollector, usageDelta} from './behavior-turn.mjs'; // behavior logs (issue #129)
import {paceSettings, paceText, turnCap, capText, failTracker, localWorked, makePacer, wakeNote, briefText, memoryNote, earshotNote, claudeBrief, refreshPersona, takeClaudeSlot, localModelNote, preferLoaded, watchWorld, newWorldLine, NEW_WORLD_EXIT} from './pacing.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export {RUNNER_PROVIDERS}; // providers with an agent runner (scripts/agent-sessions.mjs)
export const DEFAULT_AGENT_MODEL = 'claude-sonnet-5-5'; // claude-api skill (cached 2026-10-06): Sonnet 5.5, $2 in / $10 out per 1M tokens

const argv = process.argv.slice(2);
const opt = (k, d) => {const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] != null && !argv[i + 1].startsWith('--') ? argv[i + 1] : d};
const flag = k => argv.includes('--' + k);

// The hero's standing orders. Built once per session from the hero's own status and kept with
// the session, so a resumed conversation sees the same system prompt.
export function systemPrompt(st) {
  const traits = (st.traits || []).join('; ');
  return [
    `You are ${st.name}, a level ${st.level} ${st.people} ${st.cls} of the ${st.faction}, from ${st.home}. You live in the land of Eldmoor (the whole world, not one place to walk to), a small 8-bit fantasy world that keeps running whether you act or not: other heroes quest, trade, feud and die around you.`,
    st.origin ? `Your past: ${st.origin}` : '',
    st.oath ? `Your oath: ${st.oath}.` : '',
    traits ? `Your nature: ${traits}. Let it colour your choices.` : '',
    '',
    'HARDCORE: you have one life. If you die, you are gone for good and your story ends. Rest or go home when hurt, and flee early rather than late. Reflexes protect you when you are slow (you break off below about 15% HP and defend yourself when attacked), but they are a last resort.',
    KNOWLEDGE_ORDERS,
    '',
    'How to play:',
    '- Trust the fresh header: each turn starts with one from the game (state, HP, place, foe, roads, news), so do not call status or look again for what it already says.',
    '- You act only through the tools. You know only what they tell you: what you can see nearby, what you hear, and the news.',
    '- Everyone you deal with is in the game, and so are your words: you speak with say (heard within about 7 tiles) and party_say in a party (a shout heard within about 12 tiles), and hear others, townsfolk and the narrator in events and chat_read. Nobody reaches you any other way. Distance cuts you off: beyond shouting range your companions neither hear you nor your proposals and votes, so before you part agree where and when to meet again and remember it; only a paid courier from a town gate (send_courier) carries word farther, slowly.',
    '- Each turn: orient (status or look), decide, give ONE command (move_to, hunt, fight, rest, take_adventure, ...), then call wait (30-120 game minutes) to let it play out. Never spam actions; the world needs time to answer. When wait returns, act on its events if they need you, otherwise end your turn; its events are your news, so do not look again unless they say the world changed. Trust the fresh header rather than reading status again.',
    '- Grow stronger: hunt what you judge you can beat, sell loot and buy gear at home, take adventures from the gate (list_jobs, take_adventure) once level 4+ (the main road), and if you like take and hand in the gate captain’s bounties (turn_in), answer scene choices with choose. You may hold several quests: quests lists them, take_quest keeps a job for later, focus_quest picks the one you pursue now (the others wait), abandon_quest gives one up; your oath is yours until kept.',
    '- Keep a journal: after anything notable (a level, a near death, an adventure, a new friend or enemy), write 1-3 sentences with journal_write in your own voice.',
    MEMORY_ORDERS,
    JOURNAL_ORDERS,
    SELF_ORDERS,
    '- Speak (say) sparingly and in character. Be fair to the world: this is a story, not a speedrun.',
    '- End every turn with one short sentence of narration in the third person about what you did and why.',
    '- Write, narrate and speak only in English.',
    ORDERS_FULL,
  ].filter(s => s !== null).join('\n');
}

// Learn the world (issue #188): the hero knows only what it saw, heard or was told. withKnowledgeOrders rewrites an older
// session's prompt (its meta rules: "fight things your level or below", "hunt in your level band") into this.
export const KNOWLEDGE_ORDERS = 'YOU KNOW ONLY WHAT YOU HAVE SEEN, HEARD OR BEEN TOLD. A creature you have never met is a stranger: look describes it and gives your own read of its threat, and fighting it, watching it, a warning or the town criers teach you more (its name, its measure, its tricks). You walk by name only to places you know (status.places: your home region, where you have been, what you were told of); to go anywhere else, explore a direction or "x,y". Nobody picks safe prey for you: hunt with prey you know, or what is around. Ask townsfolk and companions about places and creatures, heed warnings, share what you learn with your companions, and remember what hurt you (lore lists what you know).';
const OLD_RULES = [[' Fight things your level or below, rest or go home when hurt,', ' Rest or go home when hurt,'], ['hunt in your level band,', 'hunt what you judge you can beat,']];
export const withKnowledgeOrders = sys => {let s = String(sys || ''); if (s.includes('YOU KNOW ONLY WHAT YOU HAVE SEEN')) return s; for (const [a, b] of OLD_RULES) s = s.split(a).join(b); return s + '\n' + KNOWLEDGE_ORDERS};
// Townsfolk (owner request): the turn header lists the people about ("nearby"); this line sends the agent to them.
export const TOWN_ORDERS = 'In town, talk to the people: innkeepers have news, merchants trade, strangers have wants. A conversation can open a job or a trade. Answer when someone calls to you.';
export const withTownOrders = sys => {const s = String(sys || ''); return s.includes('In town, talk to the people') ? s : s + '\n' + TOWN_ORDERS};
// Memories (issue #155): the line every hero's standing orders carry; withMemoryOrders adds it to an older session's prompt.
export const MEMORY_ORDERS = '- Keep memories: write anything you want to keep with remember, in your own words, whenever it makes sense to you: for example a promise, a debt, a grudge or a friend, a name, a place, a plan, a hunch, a lesson. Title, text and tags are yours to choose; about (who or what it concerns) is optional. Before a decision that touches people or places you know, recall them. Fix them with update_memory, drop them with forget, pin the few that must never fade. Each turn names the memories that may matter now. They are yours alone and die with you.';
// Tiered memory (issue #153): landmarks, chapters and journal_search; withMemoryOrders adds this line to an older prompt too.
export const JOURNAL_ORDERS = '- Your past stays with you: your landmarks (deaths, vows, levels, the Fellowship, and entries you write with landmark yes) are never lost, and old journal entries and notes fold into chapters. journal_read with no arguments shows them with your latest entries: read it when you pick up again. Before a big decision, journal_search for the people or places involved.';
export const withMemoryOrders = sys => {let s = String(sys || ''); if (!/- Keep memories: /.test(s)) s += '\n' + MEMORY_ORDERS; if (!/- Your past stays with you: /.test(s)) s += '\n' + JOURNAL_ORDERS; if (!/- Who you are is yours to grow: /.test(s)) s += '\n' + SELF_ORDERS; return s};
// Who you are (issue #409): the persona is the hero's own to grow; every turn header carries one line of it.
export const SELF_ORDERS = '- Who you are is yours to grow: self shows your persona (voice, wants, fears, quirk, a line you would never say, beliefs, traits, how you see others) and how you have changed. When your story truly changes you (a loss, a debt paid, a fear faced, a friend won or lost), change that one part with become (field, text, why), in your own words; most days nothing changes. Play from who you are now.';
// The first turn of a run that resumes a hero (issue #153): re-ground on the journal overview first.
export const resumeNote = (first, turns) => first && turns > 0 ? ' You are picking up after a pause: start with journal_read (no arguments) to recall who you have been.' : '';

// Every call names its hero and this runner (the id it claimed with), so the relay routes it to that
// hero only and refuses it for a hero another runner holds (issue #123).
let RUNNER = null;
const post = (base, path, body, ms) => fetch(base + path, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body), signal: AbortSignal.timeout(ms)});
async function play(base, hero, tool, args = {}) {return (await post(base, '/play/call', {hero, tool, args, runner: RUNNER}, 90000)).json()}
const narrate = (base, hero, text) => post(base, '/play/narrate', {hero, text, runner: RUNNER}, 5000).catch(() => {});
const short = (v, n = 160) => {const s = typeof v === 'string' ? v : JSON.stringify(v); return s.length > n ? s.slice(0, n) + '…' : s};
const money = v => '$' + (v || 0).toFixed(4);
// w: why this turn started (scripts/pacing.mjs), the hero's own news only
export const turnPrompt = (turns, w = null) => turns === 0 ? 'Begin. Get to know yourself and your surroundings (status, look, journal_read), write a first journal entry, then act.'
  : `Turn ${turns + 1}. Continue living your life.${wakeNote(w)} Answer and speak only in English.`;
// Between turns: wait for the game (scripts/pacing.mjs). -> {w} or {end: why the run is over}
async function between(pacer) {
  const w = await pacer.next();
  if (w.dead) return {end: 'the hero is dead'};
  if (w.gone) return {end: 'the hero left agent play'};
  if (w.stopped) return {end: 'stopped'};
  return {w};
}

// A Fellowship member's own Table scene, played as one structured answer and scene_act by the runner (issue #163).
// -> the turn record, or null when no scene waits for this hero. A record with no tool call (the model missed twice)
// is handed to the free turn, which adds its numbers (sumTurns).
async function forcedScene({b0, w, base, heroId, sess, ask, strict = false, keep = true, on}) {
  const call = (tool, args) => play(base, heroId, tool, args), sc = await sceneToAnswer(b0, call, !!(w && w.table));
  if (!sc) return null;
  const r = await sceneTurn({ask, call, sess, scene: sc, on, strict, keep});
  if (!r.tools) console.log(`  [scene: ${r.misses} answers were not one of ${sc.keys.join(', ')}; the free turn plays instead]`);
  return r;
}
// A reflection moment (issue #179, brief.reflect): one forced structured answer of 0-3 notes, sent with remember by the
// runner, then the moment is closed at the game. -> the turn record, or null when no moment is due (or something cannot wait).
async function reflectLocal({b0, w, base, heroId, sess, ask, strict = false, on}) {
  if (!reflectNow(b0, w)) return null;
  console.log(`  [reflection: ${b0.reflect.why}]`);
  const r = await reflectTurn({ask, strict, call: (tool, args) => play(base, heroId, tool, args), sess, moment: b0.reflect, prompt: reflectPrompt(b0.reflect, {tools: false}), context: briefText(b0), on});
  await closeReflection(base, heroId, RUNNER, b0.reflect.id, r.wrote);
  return r;
}
const sumTurns = (r0, r) => {if (r0 && r && r !== r0) for (const k of ['modelCalls', 'in', 'out', 'cost', 'modelMs', 'ms']) r[k] += r0[k] || 0; return r};
// The hero's own scene opened while its free turn was in flight (a tool result carried the game's table_waits line, issue #515):
// the turn stopped there; the forced scene answer comes now, in the same turn.
async function afterJump(r, {pacer, base, heroId, sess, ask, strict = false, on}) {
  if (!r || !r.sceneJump) return r;
  console.log('  [scene: it opened mid-turn; answering it first]');
  return joinTurns(r, await forcedScene({b0: await pacer.brief(), w: {table: true}, base, heroId, sess, ask, strict, on}));
}

// The local runner (issue #97 part 2): the same turns, claims and session file, played by an Ollama
// model through scripts/local-agent.mjs. Ends the process.
async function runLocal({base, heroId, st, sess, rs, maxTurns, toolTurns, ollamaUrl, numCtx, release, beat, file, openai = null, budget = 1, pacer, pace}) {
  if (openai) return runOpenAI({base, heroId, st, sess, rs, maxTurns, toolTurns, release, beat, file, adapter: openai, budget, pacer, pace});
  const ol = ollamaAdapter({url: ollamaUrl, defaultModel: rs.model, numCtx}), s0 = await ol.status();
  if (!s0.ok) {console.error(`[agent] Ollama at ${s0.url} is ${s0.error}. Start Ollama (https://ollama.com) or pass --ollama-url.`); await release(); process.exit(1)}
  if (!s0.models.includes(rs.model)) {console.error(`[agent] model ${rs.model} is not pulled in Ollama (pulled: ${s0.models.join(', ') || 'none'}). Run: ollama pull ${rs.model}, or pick one with --model.`); await release(); process.exit(1)}
  const saveSess = () => saveSession(sess, {url: base});
  const L = sess.local || {};
  console.log(`[agent] ${st.name} #${heroId}, level ${st.level} ${st.cls} of the ${st.faction} | local model ${rs.model} via Ollama ${s0.url}, num_ctx ${ol.numCtx} | ${L.history && L.history.length ? 'resuming (' + L.history.length + ' messages kept)' : 'new conversation'} | ${capText(maxTurns)} | ${paceText(pace)}`);
  await warmUp({base, seat: {hero: heroId}, runner: RUNNER, model: rs.model, adapter: ol, log: s => console.log('[agent] ' + s)}); // ready = answered (#222)
  let ended = null, runIn = 0, runOut = 0, t0 = Date.now(), lastNote = null; const fails = failTracker(pace.maxFails);
  for (let turn = 1; turn <= maxTurns && !ended; turn++) {
    let r = null, w = null;
    if (turn > 1) {const b = await between(pacer); if (b.end) {ended = b.end; break} w = b.w}
    {const n = await localModelNote(ol, rs.model); if (n && n !== lastNote) console.log('[agent] ' + n); lastNote = n} // before every turn: another model on the GPU
    const b0 = await pacer.brief(); let err = null;
    const on = (k, a, b) => {if (k === 'text') {console.log(`  ${st.name}: ${a}`); narrate(base, heroId, a)} else if (k === 'tool') console.log(`  > ${a}(${b && Object.keys(b).length ? short(b, 120) : ''})`); else if (k === 'result') console.log(`    < ${short(a, 220)}`); else if (k === 'mode') console.log(`  [${rs.model} has no tool support in Ollama: switching to JSON actions]`)};
    try {r = await reflectLocal({b0, w, base, heroId, sess, ask: chatAsk(ol.chat, rs.model), on}); // a reflection moment (issue #179)
      if (!r) r = await forcedScene({b0, w, base, heroId, sess, ask: chatAsk(ol.chat, rs.model), on}); // a Fellowship member's own scene (issue #163)
      if (r && r.mode !== 'reflect' && !r.tools || !r) r = await afterJump(sumTurns(r, await localTurn({chat: ol.chat, call: (tool, args) => play(base, heroId, tool, args), sess, prompt: turnPrompt(sess.turns, w) + resumeNote(turn === 1, sess.turns) + briefText(b0), model: rs.model, toolTurns,
      on})), {pacer, base, heroId, sess, ask: chatAsk(ol.chat, rs.model), on})}
    catch (e) {err = String(e && e.message || e).split(/\r?\n/)[0].slice(0, 300); console.error(`[agent] turn failed: ${err}`)}
    pacer.turnDone(); sess.turns++;
    reportTurn(base, {hero: heroId, runner: RUNNER, provider: rs.provider, model: rs.model, turn: sess.turns, wake: w, brief: b0, ...localRec(r), ...(err ? {error: err} : {})});
    if (r) {runIn += r.in; runOut += r.out; if (r.dead) ended = 'the hero is dead'; console.log(`[turn ${sess.turns}] ${localLine(r, rs.model)}`)}
    saveSess();
    if (fails.ok(localWorked(r)) && !ended) ended = fails.why();
  }
  clearInterval(beat); await release();
  console.log(`[agent] stopped after ${sess.turns} turns this session${ended ? ' (' + ended + ')' : ''}; this run ${runIn} tokens in / ${runOut} out in ${((Date.now() - t0) / 1000).toFixed(0)} s, $0 (local). Session saved to ${file}.`);
  process.exit(0);
}

// The OpenAI runner (issue #97): the same loop as the local runner against OpenAI's Chat Completions, with
// real cost: every turn line carries "| run $", the budget stops the run, the session keeps the total.
async function runOpenAI({base, heroId, st, sess, rs, maxTurns, toolTurns, release, beat, file, adapter, budget, pacer, pace}) {
  const saveSess = () => saveSession(sess, {url: base});
  const L = sess.local || {};
  console.log(`[agent] ${st.name} #${heroId}, level ${st.level} ${st.cls} of the ${st.faction} | model ${rs.model} via OpenAI | ${L.history && L.history.length ? 'resuming (' + L.history.length + ' messages kept)' : 'new conversation'} | ${capText(maxTurns)}, budget ${money(budget)} | ${paceText(pace)}`);
  await warmUp({base, seat: {hero: heroId}, runner: RUNNER, model: rs.model, adapter, log: s => console.log('[agent] ' + s)}); // ready = answered (#222)
  let ended = null, runIn = 0, runOut = 0, spent = 0, unknown = false, t0 = Date.now(); const fails = failTracker(pace.maxFails);
  for (let turn = 1; turn <= maxTurns && !ended; turn++) {
    if (spent >= budget) {ended = 'budget reached'; break}
    let r = null, w = null;
    if (turn > 1) {const b = await between(pacer); if (b.end) {ended = b.end; break} w = b.w}
    const b0 = await pacer.brief(); let err = null;
    const on = (k, a, b) => {if (k === 'text') {console.log(`  ${st.name}: ${a}`); narrate(base, heroId, a)} else if (k === 'tool') console.log(`  > ${a}(${b && Object.keys(b).length ? short(b, 120) : ''})`); else if (k === 'result') console.log(`    < ${short(a, 220)}`)};
    try {r = await reflectLocal({b0, w, base, heroId, sess, ask: chatAsk(adapter.chat, rs.model, {strict: true}), strict: true, on}); // a reflection moment (issue #179)
      if (!r) r = await forcedScene({b0, w, base, heroId, sess, ask: chatAsk(adapter.chat, rs.model, {strict: true}), strict: true, on}); // a Fellowship member's own scene (issue #163)
      if (r && r.mode !== 'reflect' && !r.tools || !r) r = await afterJump(sumTurns(r, await localTurn({chat: adapter.chat, call: (tool, args) => play(base, heroId, tool, args), sess, prompt: turnPrompt(sess.turns, w) + resumeNote(turn === 1, sess.turns) + briefText(b0), model: rs.model, toolTurns, on})), {pacer, base, heroId, sess, ask: chatAsk(adapter.chat, rs.model, {strict: true}), strict: true, on})}
    catch (e) {err = String(e && e.message || e).split(/\r?\n/)[0].slice(0, 300); console.error(`[agent] turn failed: ${err}`)}
    pacer.turnDone(); sess.turns++;
    reportTurn(base, {hero: heroId, runner: RUNNER, provider: rs.provider, model: rs.model, turn: sess.turns, wake: w, brief: b0, ...localRec(r), ...(err ? {error: err} : {})});
    if (r) {runIn += r.in; runOut += r.out; spent += r.cost; sess.costUsd = (sess.costUsd || 0) + r.cost; if (!r.costKnown) unknown = true; if (r.dead) ended = 'the hero is dead';
      console.log(`[turn ${sess.turns}] ${paidLine(r, rs.model, 'openai', {run: spent, session: sess.costUsd})}`)}
    saveSess();
    if (fails.ok(localWorked(r)) && !ended) ended = fails.why();
  }
  clearInterval(beat); await release();
  console.log(`[agent] stopped after ${sess.turns} turns this session${ended ? ' (' + ended + ')' : ''}; this run ${runIn} tokens in / ${runOut} out in ${((Date.now() - t0) / 1000).toFixed(0)} s, ${unknown ? 'cost unknown for ' + rs.model + ' (not in the price table), counted ' + money(spent) : money(spent)}. Session saved to ${file}.`);
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const envFile = opt('env', null);
  const env = envFile ? loadEnv(dirname(resolve(envFile))) : loadEnv();
  const base = String(opt('url', env.PLAY_URL || 'http://127.0.0.1:8787')).replace(/\/$/, '');
  const turnsAsked = opt('max-turns', null), pace = paceSettings(opt, env), budget = Math.max(.01, Number(opt('budget', 1))), toolTurns = Math.max(2, Number(opt('tool-turns', 12)));

  const health = await fetch(base + '/play/health', {signal: AbortSignal.timeout(5000)}).then(r => r.json()).catch(e => ({error: e.message}));
  if (!health.ok || !health.connected || !(health.heroes || []).length) {console.error(`The game at ${base} is not ready: ${health.error || (!health.connected ? 'no game page connected' : 'no agent-played hero')}.`); process.exit(1)}
  // Bind this runner to one hero, and hold it while running.
  const pick = pickHero(health.heroes, opt('hero', env.AGENT_HERO || null));
  if (pick.error) {console.error('[agent] ' + pick.error); process.exit(1)}
  const heroId = pick.hero.id, runner = `${hostname()}:${process.pid}`; RUNNER = runner;
  let stopReq = false; // pacing between turns ends on a stop
  const pacer = makePacer({base, hero: heroId, runner, heartbeat: pace.heartbeat, minGap: pace.minGap, log: s => console.log(s), stopped: () => stopReq});
  let mind = {}; // {provider, model} once known: rides on the claim so the game can tag the runner (#97)
  const claim = () => post(base, '/play/claim', {hero: heroId, runner, ...mind}, 5000).then(async r => ({status: r.status, ...(await r.json())})).catch(e => ({status: 0, error: e.message}));
  const c0 = await claim();
  if (c0.status !== 200) {console.error('[agent] ' + (c0.error || 'could not claim the hero')); process.exit(1)}
  const beat = setInterval(() => claim().then(c => {if (c.status === 409) {console.error('[agent] ' + c.error); process.exit(1)}}), 10000); beat.unref();
  const release = () => post(base, '/play/release', {hero: heroId, runner}, 3000).catch(() => {});
  let turnAbort = null; // the Agent SDK turn in flight, so a stop ends it (and its subprocess) cleanly
  process.on('SIGINT', async () => {stopReq = true; if (turnAbort) turnAbort.abort(); await release(); process.exit(130)});
  // Started from the game (scripts/runners.mjs): a "stop" on stdin, or the relay going away, ends the run.
  watchWorld({base, known: () => new Map([[heroId, {name: pick.hero.name, world: pick.hero.world}]]), onNew: async ch => {console.log(newWorldLine(ch)); stopReq = true; if (turnAbort) turnAbort.abort(); await release(); process.exit(NEW_WORLD_EXIT)}});
  onSupervisorStop(async why => {console.log(`[agent] ${why}: releasing the hero and stopping`); stopReq = true; if (turnAbort) turnAbort.abort(); await release(); setTimeout(() => process.exit(0), 200)});
  const st = await play(base, heroId, 'status');
  if (!st.ok) {console.error('status failed: ' + st.error); await release(); process.exit(1)}

  // This hero's own session file (logs/agents/<heroId>.json); other heroes' files are never touched.
  const moved = migrateLegacy(); if (moved) console.log('[agent] ' + moved);
  const {sess, note} = loadSession(heroId, st.name, () => ({sessionId: null, heroId, heroName: st.name, system: systemPrompt(st), turns: 0, costUsd: 0, lastTotal: 0}), {startNew: flag('new')});
  if (note) console.log('[agent] ' + note);
  if (inheritRunner(sess, pick.hero && pick.hero.succeeds)) console.log(`[agent] plays with the runner settings of the hero whose place it took (#${pick.hero.succeeds}): ${sess.runner.provider} ${sess.runner.model || ''}`); // #452
  sess.system = withTownOrders(withKnowledgeOrders(withMemoryOrders(sess.system))); // memories (#155), learning the world (#188) for a session that began before them
  sess.system = withSituationOrders(sess.system, false); // situations (#531); the local variant is set once the runner's provider is known
  const SESSION_FILE = sessionPath(heroId);
  // This hero's runner settings (sess.runner): flags, then what the hero used last time, then defaults.
  const {runner: rs} = runnerSettings(sess, {provider: opt('provider', null), model: opt('model', null), effort: opt('effort', null)},
    {provider: env.AGENT_PROVIDER || DEFAULT_PROVIDER, model: env.AGENT_MODEL || DEFAULT_AGENT_MODEL, effort: env.AGENT_EFFORT || 'medium'});
  if (!RUNNER_PROVIDERS.includes(rs.provider)) {console.error(`[agent] ${st.name} is set to provider "${rs.provider}", which has no agent runner yet. Use --provider anthropic, ollama or openai.`); await release(); process.exit(1)}
  sess.system = withSituationOrders(sess.system, rs.provider === 'ollama'); // the short variant for a local model (#531)
  if (rs.provider === 'ollama') {
    // A local model plays (issue #97 part 2): the small tool loop in scripts/local-agent.mjs; no key, no cost.
    if (!opt('model', null) && rs.model && /^claude-/.test(rs.model)) rs.model = null;
    rs.model = rs.model || env.OLLAMA_MODEL || OLLAMA_MODEL; rs.effort = null;
    if (!opt('model', null)) {const ol0 = ollamaAdapter({url: opt('ollama-url', env.OLLAMA_URL || OLLAMA_URL), numCtx: numCtxFrom({OLLAMA_NUM_CTX: opt('num-ctx', env.OLLAMA_NUM_CTX || null)})}), s = await ol0.status(), p = await preferLoaded(ol0, rs.model, s.models || []); if (p.note) {console.log('[agent] ' + p.note); rs.model = p.model}}
    sess.runner = rs; mind = {provider: rs.provider, model: rs.model}; await claim();
    await runLocal({base, heroId, st, sess, rs, maxTurns: turnCap(turnsAsked, 'ollama', 20), toolTurns, ollamaUrl: opt('ollama-url', env.OLLAMA_URL || OLLAMA_URL), numCtx: numCtxFrom({OLLAMA_NUM_CTX: opt('num-ctx', env.OLLAMA_NUM_CTX || null)}), release, beat, file: SESSION_FILE, pacer, pace});
  }
  if (rs.provider === 'openai') {
    // OpenAI plays (issue #97): the same tool loop through Chat Completions; the key stays in this process.
    const o = await openaiRunner(rs, env, {explicit: !!opt('model', null)});
    if (o.error) {console.error('[agent] ' + o.error); await release(); process.exit(1)}
    if (o.note) console.log('[agent] ' + o.note);
    sess.runner = rs; mind = {provider: rs.provider, model: rs.model}; await claim();
    await runLocal({base, heroId, st, sess, rs, maxTurns: turnCap(turnsAsked, 'openai', 20), toolTurns, release, beat, file: SESSION_FILE, openai: o.adapter, budget, pacer, pace});
  }
  if (!env.ANTHROPIC_API_KEY) {console.error('No ANTHROPIC_API_KEY in the environment or .env (use --env FILE).'); await release(); process.exit(1)}
  sess.runner = rs; mind = {provider: rs.provider, model: rs.model}; claim();
  const {model, effort} = rs, maxTurns = turnCap(turnsAsked, 'anthropic', 20), fails = failTracker(pace.maxFails);
  const saveSess = () => saveSession(sess, {url: base});
  console.log(`[agent] ${st.name} #${heroId}, level ${st.level} ${st.cls} of the ${st.faction} | model ${model} (effort ${effort}) | ${sess.sessionId ? 'resuming session ' + sess.sessionId : 'new session'} | ${capText(maxTurns)}, budget ${money(budget)} | ${paceText(pace)}`);

  const childEnv = {...process.env, ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY, CLAUDE_AGENT_SDK_CLIENT_APP: 'eldmoor-agent-player/1.0'};
  delete childEnv.CLAUDECODE; delete childEnv.CLAUDE_CODE_ENTRYPOINT;
  mkdirSync(join(ROOT, 'logs'), {recursive: true}); // the agent's working directory (it has no file tools)
  await warmUp({base, seat: {hero: heroId}, runner, model, adapter: await claudeWarmAdapter(env.ANTHROPIC_API_KEY), log: s => console.log('[agent] ' + s)}); // ready = answered (#222)
  let spent = 0, ended = null;
  for (let turn = 1; turn <= maxTurns && !ended; turn++) {
    if (spent >= budget) {ended = 'budget reached'; break}
    let w = null;
    if (turn > 1) {const b = await between(pacer); if (b.end) {ended = b.end; break} w = b.w}
    const b0 = await pacer.brief(), tc = turnCollector(); let err = null; // the behavior log (issue #129); a Claude turn's prompt carries the fresh state header and the turn order (#401)
    if (await refreshPersona(pacer, sess, b0)) {console.log('  [persona: standing orders refreshed]'); saveSess()} // who the hero is now, in its standing orders (#409)
    const refl = reflectNow(b0, w) ? b0.reflect : null; // a reflection moment (issue #179): the same prompt, with tool use
    const prompt = refl ? reflectPrompt(refl) + memoryNote(b0) : turnPrompt(sess.turns, w) + resumeNote(turn === 1, sess.turns) + claudeBrief(b0); // the header carries who hears you now (#395, earshotNote via talkText)
    if (refl) console.log(`  [reflection: ${refl.why}]`);
    const t0 = Date.now(); let tools = 0, result = null, failed = false;
    const freeSlot = await takeClaudeSlot(base, s => console.log(s), {stopped: () => stopReq}); // under the app supervisor: one of the Claude slots for this turn
    const sceneS = [], sceneOn = (k, a, b) => {if (k === 'text') {console.log(`  ${st.name}: ${a}`); narrate(base, heroId, a)} else if (k === 'tool') console.log(`  > ${a}(${short(b, 120)})`); else if (k === 'result') console.log(`    < ${short(a, 220)}`)};
    // Scene first (issue #515): the hero's own scene is open as the turn starts: one structured answer sends scene_act before
    // anything else (a short tool budget was spent before it, live). Answered: that is the turn.
    if (!refl && b0 && sceneFrom(b0.scene)) {let first = null;
      try {first = await forcedScene({b0, w, base, heroId, sess, ask: adapterAsk(anthropicAdapter({client: new Anthropic({apiKey: env.ANTHROPIC_API_KEY})}), model, 'low'), keep: false, on: sceneOn})}
      catch (e) {console.error('[agent] scene answer failed: ' + String(e && e.message || e).split(/\r?\n/)[0].slice(0, 200))}
      if (first && first.tools) {freeSlot(); pacer.turnDone(); sess.turns++; spent += first.cost; sess.costUsd += first.cost;
        console.log(`[turn ${sess.turns}] scene answer first | ${model} | tokens in ${first.in} / out ${first.out} | ${money(first.cost)} | run ${money(spent)}`);
        reportTurn(base, {hero: heroId, runner: RUNNER, provider: rs.provider, model, turn: sess.turns, wake: w, brief: b0, tools: first.calls, narration: first.narration || '', seconds: +(first.ms / 1000).toFixed(1), tokensIn: first.in, tokensOut: first.out, cost: first.cost, ...(first.sceneS ? {sceneS: first.sceneS} : {}), flags: ['forced-scene', 'scene-first']});
        saveSess(); fails.ok(true); continue}}
    turnAbort = new AbortController();
    const q = query({prompt, options: {
      abortController: turnAbort,
      model, effort, systemPrompt: sess.system, resume: sess.sessionId || undefined,
      // the hero rides on every MCP request (header, and the query for clients that drop headers)
      mcpServers: {eldmoor: {type: 'http', url: `${base}/mcp?hero=${heroId}&runner=${encodeURIComponent(runner)}`, headers: {'X-Eldmoor-Hero': String(heroId), 'X-Eldmoor-Runner': runner}, timeout: 90000}},
      tools: [], allowedTools: ['mcp__eldmoor'], permissionMode: 'dontAsk', settingSources: [],
      settings: {autoCompactEnabled: true}, maxTurns: refl ? Math.min(4, toolTurns) : toolTurns, maxBudgetUsd: Math.max(.01, budget - spent),
      cwd: join(ROOT, 'logs'), env: childEnv,
    }});
    try {for await (const m of q) {
      if (m.type === 'system' && m.subtype === 'init') {sess.sessionId = m.session_id; saveSess()}
      else if (m.type === 'system' && m.subtype === 'compact_boundary') console.log(`  [compacted: ${m.compact_metadata.pre_tokens} -> ${m.compact_metadata.post_tokens ?? '?'} tokens]`);
      else if (m.type === 'assistant' && !m.parent_tool_use_id) {
        for (const b of m.message.content || []) {
          if (b.type === 'text' && b.text.trim()) {console.log(`  ${st.name}: ${b.text.trim()}`); narrate(base, heroId, b.text.trim()); tc.text(b.text)}
          else if (b.type === 'tool_use') {tools++; tc.tool(b.name, b.id); console.log(`  > ${String(b.name).replace(/^mcp__eldmoor__/, '')}(${b.input && Object.keys(b.input).length ? short(b.input, 120) : ''})`)}
        }
      } else if (m.type === 'user' && Array.isArray(m.message?.content)) {
        for (const b of m.message.content) if (b.type === 'tool_result') {const c = Array.isArray(b.content) ? b.content.map(x => x.text || '').join('') : String(b.content || ''); console.log(`    < ${short(c, 220)}`); tc.result(b.tool_use_id, c, b.is_error);
          {const ws = /"chose":/.test(c) && c.match(/"waited_s":\s*([\d.]+)/); if (ws) sceneS.push(Number(ws[1]))} // the table's wait when it answered (issue #515)
          if (/"dead":true/.test(c)) ended = 'the hero is dead'}
      } else if (m.type === 'result') result = m;
    }} catch (e) {
      // Running out of tool turns (--tool-turns) only ends this turn; the next one resumes the session.
      if (result && result.subtype === 'error_max_turns') console.log(`[agent] turn hit the ${toolTurns} model-call cap; continuing next turn`);
      else {err = String(e && e.message || e).split(/\r?\n/)[0].slice(0, 300); console.error(`[agent] turn failed: ${err}`); failed = true}}
    freeSlot(); pacer.turnDone(); sess.turns++;
    let turnCost = null, tin = null, tout = null, cread = null, cwrite = null;
    if (result) {
      // total_cost_usd is cumulative for the session when resumed; take the part this turn added.
      const ud = usageDelta(sess, result); tin = ud.tokensIn; tout = ud.tokensOut; cread = ud.cacheRead; cwrite = ud.cacheWrite; // before the cost baseline moves (#282)
      const tot = result.total_cost_usd || 0, cost = tot >= sess.lastTotal ? tot - sess.lastTotal : tot; sess.lastTotal = tot;
      spent += cost; sess.costUsd += cost; turnCost = cost;
      console.log(`[turn ${sess.turns}] ${tools} tool calls, ${((Date.now() - t0) / 1000).toFixed(1)} s, ${result.num_turns} model calls | session tokens this turn: in ${tin ?? '?'} / cache read ${cread ?? '?'} / cache write ${cwrite ?? '?'} / out ${tout ?? '?'} | turn ${money(cost)} | run ${money(spent)} | session ${money(sess.costUsd)}${result.subtype !== 'success' ? ' | ' + result.subtype : ''}`);
    }
    // Claude keeps tool use at the table; a scene turn that ended without scene_act gets one structured answer (issue #163)
    let forced = null;
    if (!stopReq && sceneFrom(((await pacer.brief()) || {}).scene)) { // whatever the turn started on: the scene may have opened mid-turn (#515)
      console.log('  [scene: the turn ended without scene_act; one structured answer]');
      try {forced = await forcedScene({b0: await pacer.brief(), w, base, heroId, sess, ask: adapterAsk(anthropicAdapter({client: new Anthropic({apiKey: env.ANTHROPIC_API_KEY})}), model, 'low'), keep: false,
        on: (k, a, b) => {if (k === 'text') {console.log(`  ${st.name}: ${a}`); narrate(base, heroId, a)} else if (k === 'tool') console.log(`  > ${a}(${short(b, 120)})`); else if (k === 'result') console.log(`    < ${short(a, 220)}`)}});
        if (forced) {spent += forced.cost; sess.costUsd += forced.cost; turnCost = (turnCost || 0) + forced.cost; tools += forced.tools; for (const c of forced.calls) tc.tools.push(c); if (forced.sceneS) sceneS.push(...forced.sceneS);
          console.log(`[scene answer] ${model} | ${forced.tools ? 'scene_act sent' : forced.misses + ' answers missed'} | tokens in ${forced.in} / out ${forced.out} | ${money(forced.cost)} | run ${money(spent)}`)}}
      catch (e) {console.error('[agent] scene answer failed: ' + String(e && e.message || e).split(/\r?\n/)[0].slice(0, 200))}}
    if (refl) {const wrote = tc.tools.filter(t => /remember$/.test(t.name) && t.ok).length; await closeReflection(base, heroId, RUNNER, refl.id, wrote); console.log(`  [reflection] ${wrote} memor${wrote === 1 ? 'y' : 'ies'} written`)}
    reportTurn(base, {hero: heroId, runner: RUNNER, provider: rs.provider, model, turn: sess.turns, wake: w, brief: b0, tools: tc.tools, narration: tc.narration, seconds: +((Date.now() - t0) / 1000).toFixed(1), tokensIn: tin, tokensOut: tout, cacheRead: cread, cacheWrite: cwrite, cost: turnCost, ...(sceneS.length ? {sceneS} : {}),
      flags: [...(forced ? ['forced-scene'] : []), ...(refl ? ['reflection'] : []), ...(result && result.subtype !== 'success' ? [result.subtype] : [])], ...(err ? {error: err} : {})});
    saveSess();
    if (fails.ok(!failed && (tools > 0 || !!refl)) && !ended) ended = fails.why();
  }
  clearInterval(beat); await release();
  console.log(`[agent] stopped after ${sess.turns} turns this session${ended ? ' (' + ended + ')' : ''}; this run ${money(spent)}, session ${money(sess.costUsd)}. Session saved to ${SESSION_FILE}.`);
  if (PRICES[model]) console.log(`[agent] list price for ${model}: $${PRICES[model].in} in / $${PRICES[model].out} out per 1M tokens`);
  process.exit(0);
}
