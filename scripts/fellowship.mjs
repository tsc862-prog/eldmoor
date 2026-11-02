// The Fellowship's table runner (issue #68, phase B): `npm run fellowship` plays every member of
// the Fellowship with its own Claude Agent SDK session, side by side, under one budget.
//
//   1. The game: npm run relay + npm run dev, found a Fellowship in the Fellowship panel and click
//      its Minds button until it reads "Minds: agents" (every member becomes agent-played).
//      Or headless: node scripts/play-headless.mjs --fellowship --port 8790 [--warm 20]
//   2. npm run fellowship -- [--url http://127.0.0.1:8787] [--max-turns 6] [--budget 2.00]
//
// Per member it reuses the single-hero runner's pieces (scripts/agent-sessions.mjs): one session
// file per hero (logs/agents/<heroId>.json, resumed next run; --new sets them aside), the hero's
// runner settings (sess.runner: provider, model, effort), and a claim at the relay so no second
// runner plays the same hero. Each member's system prompt is the hero's standing orders
// (scripts/agent-player.mjs) plus the Fellowship's: persona and memory come with status, the
// party tools (party_say, party_read, propose, vote, lead_to, leave_party) and Table mode.
//
// Scheduling: every member runs its own loop of turns (one query() each), paced by the game (issue
// #126, scripts/pacing.mjs): a member's next turn starts when something happens to it (a scene at the
// table, a choice, an attack, low HP: at once; a party line, a vote, an arrival, the narrator: after
// the minimum gap, --min-gap S, default 20, --cadence is the old name) or after a heartbeat of game time
// (--heartbeat MIN, default 240 game minutes). A scene opens the member's turn with a prompt to act
// with scene_act. A silent or slow agent never stalls the table: the game gives every turn a
// real-time budget and then acts by reflex. A local or OpenAI member whose own scene is open plays it as one
// forced structured answer (Ollama format / OpenAI strict json_schema: an enum of its legal options and a
// line) and the runner sends scene_act itself (issue #163); a Claude member keeps tool use, and a scene turn
// of its that ends without scene_act gets one structured Claude answer instead. A member stops when it dies or leaves agent play, and
// after --max-fails N (default 5) failed or empty turns in a row.
// Cost controls: one overall --budget for the run's paid members (each query gets what is left; several
// members may finish a turn in flight just past it), --max-turns per member (default 6 for Claude and
// OpenAI members; local members play until stopped unless it is given), and --follower-model (for
// example claude-haiku-5-5) for members other than the leader between scenes; in scenes and for
// the leader the member's own model plays.
//
// Seats stay apart (issue #123): five independent sessions. No member's text, prompt, narration or
// session ever goes into another member's context; a member's turn prompt is fixed text (memberPrompt)
// and what it knows comes from its own tools. The only shared orchestration (who is at the table,
// who leads, the cadence) is read from game state (/play/health), and votes and scenes go through
// the game's own tools. Every call names this runner, so only it can play the members it claimed.
// Logs: everything goes to the console and to logs/fellowship.log (one line per event, the
// member's name first); a run summary with per-member cost is appended to logs/fellowship-runs.jsonl.
// Options: --url (or PLAY_URL), --max-turns N (per member, default 6), --budget USD (default 2.00),
// --model / --effort / --provider (override every member's saved settings), --follower-model M,
// --min-gap S (or --cadence S; default 20), --heartbeat MIN (default 240), --max-fails N (default 5), --tool-turns N (model calls per turn, default 10), --env FILE, --new,
// --claude-concurrency N (at most N Claude member turns at once; the app runner sets it to stay under the org's cap).
// Local members (issue #97 part 2): a member whose runner provider is 'ollama' (saved in its session
// file by `npm run agent -- --hero X --provider ollama --model M`, or --provider ollama here for all)
// plays through scripts/local-agent.mjs against Ollama (--ollama-url / OLLAMA_URL, --num-ctx): same
// tools, prompts, claims, cadence and scenes, cost 0, tokens and seconds in the turn line. Mixed
// Fellowships work: Claude members still need ANTHROPIC_API_KEY, local members do not.
import {mkdirSync, appendFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join, resolve} from 'node:path';
import {hostname} from 'node:os';
import {query} from '@anthropic-ai/claude-agent-sdk';
import {loadEnv, PRICES} from './relay.mjs';
import {systemPrompt, withMemoryOrders, withKnowledgeOrders, DEFAULT_AGENT_MODEL, RUNNER_PROVIDERS} from './agent-player.mjs';
import {migrateLegacy, loadSession, saveSession, runnerSettings, DEFAULT_PROVIDER} from './agent-sessions.mjs';
import {ollamaAdapter, OLLAMA_URL, OLLAMA_MODEL} from './providers/ollama.mjs';
import {localTurn, localLine, paidLine, sceneToAnswer, sceneFrom, sceneTurn, chatAsk, adapterAsk, reflectTurn} from './local-agent.mjs';
import Anthropic from '@anthropic-ai/sdk';
import {anthropicAdapter} from './providers/anthropic.mjs';
import {openaiRunner} from './agent-chat.mjs';
import {onSupervisorStop} from './runners.mjs';
import {reportTurn, localRec, turnCollector} from './behavior-turn.mjs'; // behavior logs (issue #129)
import {paceSettings, paceText, turnCap, capText, failTracker, localWorked, makePacer, wakeNote, briefText, talkText, memoryNote, withClaudeSlot, localModelNote, preferLoaded, reflectPrompt, reflectNow, closeReflection} from './pacing.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOG_FILE = join(ROOT, 'logs', 'fellowship.log'), RUNS_FILE = join(ROOT, 'logs', 'fellowship-runs.jsonl');

// The Fellowship's part of a member's standing orders (appended to systemPrompt(status)).
export function fellowshipPrompt(st) {
  const f = st.fellowship || {};
  return [
    '',
    `FELLOWSHIP: you ride with ${f.fellowship || 'a Fellowship'} as its ${f.role || 'member'}. Four companions share your one road; their names, roles and how you see them are in status.fellowship.companions. status.fellowship also holds your voice, wants, fears, quirk, a line you would never say, your backstory and your memories: play from them, in that voice.`,
    '- Talk to your companions with party_say, a shout your companions hear only within about 12 tiles (the result says who heard and who was too far away), and catch up with party_read. DISTANCE CUTS YOU OFF: beyond that range nobody hears you, only companions within it hear a proposal or vote, and lead_to reaches only those near. If you must separate, agree aloud where and when to meet again (leave_party with where and when_hours, or a split proposal with meet_at and meet_in_hours), write it in your notes (remember), and keep to it. A paid courier (send_courier, hired at a town gate) is the only way to reach someone out of range, and it takes game hours. When you come back from a long absence, ask what you missed; when a companion returns, tell them what they missed, in your own words. Keep it short and in character. Your companions and the DM are other minds: you know only what they say in the game and what your hero sees.',
    '- You already know your companions: do not introduce yourself again, and do not repeat a line or a question (each turn shows what was said lately). Talk to move the party forward: propose, vote, lead_to, or answer a question you were asked. The game refuses a line you already said.',
    '- Decisions that need everyone (take a job, answer a Crypt or raid call, split up) go through propose(kind, details) and vote(proposal_id, yes|no, reason). Vote on every open proposal (status.proposals, or an event) with a reason in your own voice.',
    '- The leader (status.party_leader) chooses where the party goes with lead_to; everyone else follows. If you are the leader, lead: pick hunting grounds and jobs that suit the weakest of you, from what the party has seen and been told. leave_party splits you off for a while and costs you the others\' trust; do it only for a reason your character would have.',
    '- TABLE MODE: when status, look or wait show "table", the world is paused for a scene and every second counts. Act at once with scene_act(option, line), using one of the options listed, with a short line in your voice. Do not look around first. You may answer as soon as the scene opens; it happens on your turn. Then wait.',
    '- Hardcore still holds: one life each. Protect each other.',
    '- A letter: pin a memory tagged "letter" (remember, then pin) and, if you fall, whoever takes your place in the Fellowship finds it. Only that one note outlives you.',
  ].join('\n');
}

const argv = process.argv.slice(2);
const opt = (k, d) => {const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] != null && !argv[i + 1].startsWith('--') ? argv[i + 1] : d};
const flag = k => argv.includes('--' + k);
const post = (base, path, body, ms) => fetch(base + path, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body), signal: AbortSignal.timeout(ms)});
// Every call names the member and this runner (the id it claimed them with), issue #123.
let RUNNER = null;
const play = async (base, hero, tool, args = {}) => (await post(base, '/play/call', {hero, tool, args, runner: RUNNER}, 90000)).json();
const health = base => fetch(base + '/play/health', {signal: AbortSignal.timeout(5000)}).then(r => r.json()).catch(e => ({error: e.message}));
const short = (v, n = 160) => {const s = typeof v === 'string' ? v : JSON.stringify(v); return s.length > n ? s.slice(0, n) + '…' : s};
const money = v => '$' + (v || 0).toFixed(4);
const sleep = ms => new Promise(r => setTimeout(r, ms));
// A member's prompt for one turn: at the table, the first turn, or carrying on.
// w: why the turn started (scripts/pacing.mjs), the member's own news only (issue #123)
export const memberPrompt = (turns, scene, w = null) => scene ? 'The Fellowship is at the table: a scene is open and the world is paused. Read the table (status, or the event you were sent) only if you must, then act NOW with scene_act(option, line). Then wait.'
  : turns === 0 ? 'Begin. Get to know yourself, your companions and your surroundings (status, look, party_read, journal_read), say a word to the party, write a first journal entry, then act. Follow your leader.'
  : `Turn ${turns + 1}. Carry on with your companions: answer open proposals, keep to the party, and act.${wakeNote(w)} Answer and speak only in English.`;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const envFile = opt('env', null), env = envFile ? loadEnv(dirname(resolve(envFile))) : loadEnv();
  const base = String(opt('url', env.PLAY_URL || 'http://127.0.0.1:8787')).replace(/\/$/, '');
  const turnsAsked = opt('max-turns', null), budget = Math.max(.01, Number(opt('budget', 2))), toolTurns = Math.max(2, Number(opt('tool-turns', 10)));
  const pace = paceSettings(opt, env, {cadence: opt('cadence', null)}), followerModel = opt('follower-model', env.FELLOWSHIP_FOLLOWER_MODEL || null);
  mkdirSync(join(ROOT, 'logs'), {recursive: true});
  const out = (who, text) => {const line = `[${new Date().toISOString().slice(11, 19)}] ${who ? '[' + who + '] ' : ''}${text}`; console.log(line); try {appendFileSync(LOG_FILE, line + '\n')} catch {}};

  const h0 = await health(base);
  if (!h0.ok || !h0.connected) {console.error(`The game at ${base} is not ready: ${h0.error || 'no game page connected'}.`); process.exit(1)}
  const fellowsOf = h => (h.heroes || []).filter(x => x.fellow && x.alive);
  if (!fellowsOf(h0).length) {console.error('No agent-played Fellowship member. In the game, set the Fellowship panel\'s Minds to "agents" (or run play-headless with --fellowship).'); process.exit(1)}
  if (!env.ANTHROPIC_API_KEY) out(null, 'No ANTHROPIC_API_KEY in the environment or .env (use --env FILE): only members with a local runner (provider ollama) will play.');
  const moved = migrateLegacy(); if (moved) out(null, moved);

  const runnerId = `${hostname()}:${process.pid}:fellowship`; RUNNER = runnerId; const childEnv = {...process.env, ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY, CLAUDE_AGENT_SDK_CLIENT_APP: 'eldmoor-fellowship/1.0'};
  delete childEnv.CLAUDECODE; delete childEnv.CLAUDE_CODE_ENTRYPOINT;
  const members = new Map(); // heroId -> {id, name, sess, rs, turns, cost, ended, scene}
  let spent = 0, stopping = null, inScene = new Set(), leadId = null;
  // the claim names the member's runner model once it is known, so the game can tag it (#97)
  const mindOf = id => {const m = members.get(id); return m && m.rs ? {provider: m.rs.provider, model: m.rs.model} : {}};
  const claim = (id, mind = mindOf(id)) => post(base, '/play/claim', {hero: id, runner: runnerId, ...mind}, 5000).then(async r => ({status: r.status, ...(await r.json())})).catch(e => ({status: 0, error: e.message}));
  const release = id => post(base, '/play/release', {hero: id, runner: runnerId}, 3000).catch(() => {});
  const aborts = new Set(); // Agent SDK turns in flight, ended on a stop
  const adding = new Set(); // members being added (the watcher calls addMember every second)
  let ollama = null; // the local adapter, made when the first local member joins
  let openaiChat = null; // the OpenAI adapter's chat(), set when an OpenAI member joins (all share one key and base URL)
  let claudeAd = null; // a structured Claude call for a scene turn that ended without scene_act (issue #163); the key stays in this process
  const claudeAdapter = () => claudeAd || (claudeAd = anthropicAdapter({client: new Anthropic({apiKey: env.ANTHROPIC_API_KEY})}));
  const skip = (h, why) => {out(h.name, why); members.set(h.id, {id: h.id, name: h.name, ended: 'skipped'})};

  async function addMember(h) {
    if (members.has(h.id) || adding.has(h.id)) return;
    adding.add(h.id);
    try {await addMember1(h)} finally {adding.delete(h.id)}
  }
  async function addMember1(h) {
    const c = await claim(h.id); if (c.status !== 200) {out(h.name, 'skipped: ' + (c.error || 'could not claim')); members.set(h.id, {id: h.id, name: h.name, ended: 'claimed elsewhere'}); return}
    const st = await play(base, h.id, 'status'); if (!st.ok) {out(h.name, 'status failed: ' + st.error); await release(h.id); return}
    const sys = systemPrompt(st) + '\n' + fellowshipPrompt(st);
    const {sess, note} = loadSession(h.id, st.name, () => ({sessionId: null, heroId: h.id, heroName: st.name, system: sys, turns: 0, costUsd: 0, lastTotal: 0}), {startNew: flag('new')});
    if (note) out(st.name, note);
    if (!String(sess.system || '').includes('do not introduce yourself again')) sess.system = sys; // a hero first played solo now rides with the Fellowship; older orders get the talk rule
    sess.system = withKnowledgeOrders(withMemoryOrders(sess.system)); // memories (#155), learning the world (#188) for a session that began before them
    const {runner: rs} = runnerSettings(sess, {provider: opt('provider', null), model: opt('model', null), effort: opt('effort', null)},
      {provider: env.AGENT_PROVIDER || DEFAULT_PROVIDER, model: env.AGENT_MODEL || DEFAULT_AGENT_MODEL, effort: env.AGENT_EFFORT || 'medium'});
    if (!RUNNER_PROVIDERS.includes(rs.provider)) {skip(h, `provider "${rs.provider}" has no agent runner yet (anthropic, ollama or openai); skipped`); await release(h.id); return}
    if (rs.provider === 'ollama') {
      // a local member (issue #97 part 2): plays through scripts/local-agent.mjs, no key, cost 0
      if (!opt('model', null) && rs.model && /^claude-/.test(rs.model)) rs.model = null;
      rs.model = rs.model || env.OLLAMA_MODEL || OLLAMA_MODEL; rs.effort = null;
      // one adapter, so one Ollama queue for every local member (OLLAMA_PARALLEL, default 1)
      if (!ollama) {ollama = ollamaAdapter({url: opt('ollama-url', env.OLLAMA_URL || OLLAMA_URL)}); const n = await localModelNote(ollama, rs.model); if (n) out(null, n)}
      const s = await ollama.status();
      if (!opt('model', null) && s.ok) {const p = await preferLoaded(ollama, rs.model, s.models); if (p.note) {out(h.name, p.note); rs.model = p.model}}
      if (!s.ok || !s.models.includes(rs.model)) {skip(h, s.ok ? `local model ${rs.model} is not pulled (pulled: ${s.models.join(', ') || 'none'}; ollama pull ${rs.model}); skipped` : `Ollama at ${s.url} is ${s.error}; skipped`); await release(h.id); return}
    } else if (rs.provider === 'openai') {
      // an OpenAI member (issue #97): the same loop against Chat Completions, real cost; the key stays in this process
      const o = await openaiRunner(rs, env, {explicit: !!opt('model', null)});
      if (o.error) {skip(h, o.error + '; skipped'); await release(h.id); return}
      openaiChat = o.adapter.chat;
    } else if (!env.ANTHROPIC_API_KEY) {skip(h, 'plays Claude but there is no ANTHROPIC_API_KEY in the environment or .env (use --env FILE, or --provider ollama); skipped'); await release(h.id); return}
    sess.runner = rs; saveSession(sess, {url: base});
    const m = {id: h.id, name: st.name, role: (st.fellowship || {}).role || h.role, sess, rs, local: rs.provider === 'ollama' || rs.provider === 'openai', paid: rs.provider === 'openai', turns: 0, cost: 0, tools: 0, tin: 0, tout: 0, ended: null, scenes: 0,
      maxTurns: turnCap(turnsAsked, rs.provider, 6), fails: failTracker(pace.maxFails)};
    members.set(h.id, m); claim(h.id);
    out(m.name, `${m.role || 'member'}, level ${st.level} ${st.cls} | ${m.paid ? rs.model + ' (OpenAI)' : m.local ? rs.model + ' (local, Ollama)' : rs.model + ' (effort ' + rs.effort + ')' + (followerModel ? ', ' + followerModel + ' between scenes when following' : '')} | ${m.local ? (sess.local && sess.local.history && sess.local.history.length ? 'resuming (' + sess.local.history.length + ' messages kept)' : 'new conversation') : sess.sessionId ? 'resuming ' + sess.sessionId : 'new session'} | ${capText(m.maxTurns)}`);
    loop(m).catch(e => {m.ended = 'error: ' + e.message; out(m.name, 'loop failed: ' + e.message)});
  }

  // One turn: one query() to the member's own session.
  // --claude-concurrency N: at most N Claude member turns at once (the API org's concurrent-request cap is
  // shared with the relay); the others queue, scene turns first. Local members never wait. Default: no cap.
  const claudeMax = Math.max(0, Number(opt('claude-concurrency', env.FELLOWSHIP_CLAUDE_CONCURRENCY || 0)) || 0);
  let claudeLive = 0; const claudeQ = [];
  const slot = scene => claudeMax && claudeLive >= claudeMax ? new Promise(r => {if (scene) claudeQ.unshift(r); else claudeQ.push(r)}).then(() => {claudeLive++}) : (claudeLive++, Promise.resolve());
  const free = () => {claudeLive--; const n = claudeQ.shift(); if (n) n()};
  // -> whether the turn did anything (a failed or empty turn counts toward the --max-fails stop)
  // Reflection moments (issue #179): when the game names one (brief.reflect: camp, a scene's end, a death, an oath, a
  // big trade, a conversation, the end of the day) and nothing cannot wait, this turn is a short reflection instead.
  async function turn(m, scene, w) {
    const b = !scene && m.pacer ? await m.pacer.brief() : null, refl = reflectNow(b, w) ? b.reflect : null;
    if (m.local) return refl ? localReflect(m, b, w) : localMemberTurn(m, scene, w);
    await slot(scene);
    try {return await withClaudeSlot(base, () => claudeTurn(m, scene, w, refl), s => out(m.name, s), {stopped: () => !!stopping})} finally {free()}
  }
  // A local or OpenAI member's reflection: one forced structured answer of 0-3 notes, sent with remember by the runner.
  async function localReflect(m, b0, w) {
    const call = (tool, args) => play(base, m.id, tool, args), chat = m.paid ? openaiChat : ollama.chat, numCtx = opt('num-ctx', env.OLLAMA_NUM_CTX || null) ? Number(opt('num-ctx', env.OLLAMA_NUM_CTX)) : null;
    const on = (k, a, b) => {if (k === 'text') {out(m.name, a); post(base, '/play/narrate', {hero: m.id, text: a, runner: runnerId}, 5000).catch(() => {})} else if (k === 'tool') out(m.name, `> ${a}(${short(b, 120)})`); else if (k === 'result') out(m.name, `< ${short(a, 200)}`)};
    let r = null, err = null; out(m.name, `[reflection: ${b0.reflect.why}]`);
    try {r = await reflectTurn({ask: chatAsk(chat, m.rs.model, {numCtx, strict: m.paid}), strict: m.paid, call, sess: m.sess, moment: b0.reflect, prompt: reflectPrompt(b0.reflect, {tools: false}), context: briefText(b0), on})}
    catch (e) {err = String(e && e.message || e).split(/\r?\n/)[0].slice(0, 300); out(m.name, `reflection failed: ${err}`)}
    await closeReflection(base, m.id, runnerId, b0.reflect.id, r ? r.wrote : 0); // closed even when missed: one try per moment
    m.sess.turns++; m.turns++; m.reflections = (m.reflections || 0) + 1;
    reportTurn(base, {hero: m.id, runner: runnerId, provider: m.rs.provider, model: m.rs.model, turn: m.sess.turns, wake: w, brief: b0, ...localRec(r), ...(err ? {error: err} : {})});
    if (r) {m.tools += r.tools; m.tin += r.in; m.tout += r.out; m.notes = (m.notes || 0) + r.wrote; if (r.dead) m.ended = 'dead';
      if (m.paid) {spent += r.cost; m.cost += r.cost; m.sess.costUsd = (m.sess.costUsd || 0) + r.cost; out(m.name, `[turn ${m.turns}, reflection] ${paidLine(r, m.rs.model, 'openai', {run: spent})} of ${money(budget)} | member ${money(m.cost)}`)}
      else out(m.name, `[turn ${m.turns}, reflection] ${localLine(r, m.rs.model)} | member tokens ${m.tin} / ${m.tout}`)}
    saveSession(m.sess, {url: base});
    return localWorked(r);
  }
  async function claudeTurn(m, scene, w, refl = null) {
    const model = scene || m.id === leadId || !followerModel ? m.rs.model : followerModel;
    const b0 = m.pacer ? await m.pacer.brief() : null, tc = turnCollector(); let err = null; // the behavior log (issue #129), the memory line (#155), what was said lately
    const prompt = refl ? reflectPrompt(refl) + memoryNote(b0) : memberPrompt(m.sess.turns, scene, w) + (scene ? '' : memoryNote(b0) + talkText(b0)); // a reflection (#179): the same prompt, with tool use
    if (refl) out(m.name, `[reflection: ${refl.why}]`);
    const t0 = Date.now(); let result = null, tools = 0, failed = false;
    const ac = new AbortController(); aborts.add(ac);
    const q = query({prompt, options: {
      abortController: ac,
      model, effort: m.rs.effort, systemPrompt: m.sess.system, resume: m.sess.sessionId || undefined,
      mcpServers: {eldmoor: {type: 'http', url: `${base}/mcp?hero=${m.id}&runner=${encodeURIComponent(runnerId)}`, headers: {'X-Eldmoor-Hero': String(m.id), 'X-Eldmoor-Runner': runnerId}, timeout: 90000}},
      tools: [], allowedTools: ['mcp__eldmoor'], permissionMode: 'dontAsk', settingSources: [],
      settings: {autoCompactEnabled: true}, maxTurns: scene || refl ? Math.min(4, toolTurns) : toolTurns, maxBudgetUsd: Math.max(.01, budget - spent),
      cwd: join(ROOT, 'logs'), env: childEnv,
    }});
    try {for await (const msg of q) {
      if (msg.type === 'system' && msg.subtype === 'init') {m.sess.sessionId = msg.session_id; saveSession(m.sess, {url: base})}
      else if (msg.type === 'system' && msg.subtype === 'compact_boundary') out(m.name, `[compacted: ${msg.compact_metadata.pre_tokens} -> ${msg.compact_metadata.post_tokens ?? '?'} tokens]`);
      else if (msg.type === 'assistant' && !msg.parent_tool_use_id) {
        for (const b of msg.message.content || []) {
          if (b.type === 'text' && b.text.trim()) {out(m.name, b.text.trim()); tc.text(b.text); post(base, '/play/narrate', {hero: m.id, text: b.text.trim(), runner: runnerId}, 5000).catch(() => {})}
          else if (b.type === 'tool_use') {tools++; tc.tool(b.name, b.id); out(m.name, `> ${String(b.name).replace(/^mcp__eldmoor__/, '')}(${b.input && Object.keys(b.input).length ? short(b.input, 120) : ''})`)}
        }
      } else if (msg.type === 'user' && Array.isArray(msg.message?.content)) {
        for (const b of msg.message.content) if (b.type === 'tool_result') {const c = Array.isArray(b.content) ? b.content.map(x => x.text || '').join('') : String(b.content || ''); out(m.name, `< ${short(c, 200)}`); tc.result(b.tool_use_id, c, b.is_error);
          if (/"dead":true/.test(c)) m.ended = 'dead'}
      } else if (msg.type === 'result') result = msg;
    }} catch (e) {
      if (result && result.subtype === 'error_max_turns') out(m.name, `turn hit the model-call cap; continuing next turn`);
      else {err = String(e && e.message || e).split(/\r?\n/)[0].slice(0, 300); out(m.name, `turn failed: ${err}`); failed = true}}
    aborts.delete(ac);
    m.sess.turns++; m.turns++; m.tools += tools; if (scene) m.scenes++;
    let turnCost = null, tin = null, tout = null;
    if (result) {
      const tot = result.total_cost_usd || 0, cost = tot >= m.sess.lastTotal ? tot - m.sess.lastTotal : tot; m.sess.lastTotal = tot;
      spent += cost; m.cost += cost; m.sess.costUsd += cost; turnCost = cost;
      const mu = Object.values(result.modelUsage || {}), cached = mu.reduce((t, u) => t + u.cacheReadInputTokens, 0);
      tin = mu.reduce((t, u) => t + u.inputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens, 0); tout = mu.reduce((t, u) => t + u.outputTokens, 0);
      out(m.name, `[turn ${m.turns}${scene ? ', scene' : ''}] ${model} | ${tools} tool calls, ${((Date.now() - t0) / 1000).toFixed(1)} s | tokens in ${tin} (${cached} cached) / out ${tout} | turn ${money(cost)} | member ${money(m.cost)} | run ${money(spent)} of ${money(budget)}`);
    }
    // Claude keeps tool use at the table; a scene turn that ended without scene_act gets the forced answer once (issue #163)
    let forced = null;
    if ((scene || (b0 && b0.scene)) && !stopping && m.pacer) {const sc = sceneFrom((await m.pacer.brief() || {}).scene);
      if (sc) {out(m.name, '[scene: the turn ended without scene_act; one structured answer]');
        try {forced = await sceneTurn({ask: adapterAsk(claudeAdapter(), model, 'low'), call: (tool, args) => play(base, m.id, tool, args), sess: m.sess, scene: sc, keep: false,
          on: (k, a, b) => {if (k === 'text') {out(m.name, a); post(base, '/play/narrate', {hero: m.id, text: a, runner: runnerId}, 5000).catch(() => {})} else if (k === 'tool') out(m.name, `> ${a}(${short(b, 120)})`); else if (k === 'result') out(m.name, `< ${short(a, 200)}`)}});
          spent += forced.cost; m.cost += forced.cost; m.sess.costUsd += forced.cost; turnCost = (turnCost || 0) + forced.cost; tools += forced.tools; m.tools += forced.tools;
          for (const c of forced.calls) tc.tools.push(c);
          out(m.name, `[scene answer] ${model} | ${forced.tools ? 'scene_act sent' : forced.misses + ' answers missed'} | tokens in ${forced.in} / out ${forced.out} | ${money(forced.cost)} | run ${money(spent)} of ${money(budget)}`)}
        catch (e) {out(m.name, 'scene answer failed: ' + String(e && e.message || e).split(/\r?\n/)[0].slice(0, 200))}}}
    let wrote = 0; if (refl) {wrote = tc.tools.filter(t => /remember$/.test(t.name) && t.ok).length; m.notes = (m.notes || 0) + wrote; m.reflections = (m.reflections || 0) + 1;
      await closeReflection(base, m.id, runnerId, refl.id, wrote); out(m.name, `[reflection] ${wrote} memor${wrote === 1 ? 'y' : 'ies'} written`)}
    reportTurn(base, {hero: m.id, runner: runnerId, provider: m.rs.provider, model, turn: m.sess.turns, wake: w, brief: b0, tools: tc.tools, narration: tc.narration, seconds: +((Date.now() - t0) / 1000).toFixed(1), tokensIn: tin, tokensOut: tout, cost: turnCost,
      flags: [...(scene ? ['scene'] : []), ...(refl ? ['reflection'] : []), ...(forced ? ['forced-scene'] : []), ...(result && result.subtype !== 'success' ? [result.subtype] : [])], ...(err ? {error: err} : {})});
    saveSession(m.sess, {url: base});
    return !failed && (tools > 0 || !!refl);
  }

  // A local member's turn (issue #97 part 2): the small tool loop against Ollama, same tools, prompts,
  // session file and scene handling; cost 0, tokens and seconds reported.
  async function localMemberTurn(m, scene, w) {
    let r = null;
    if (!m.paid) {const n = await localModelNote(ollama, m.rs.model); if (n && n !== m.note) out(m.name, n); m.note = n} // another model on the GPU (#126)
    const b0 = m.pacer ? await m.pacer.brief() : null; let err = null;
    const call = (tool, args) => play(base, m.id, tool, args), chat = m.paid ? openaiChat : ollama.chat, numCtx = opt('num-ctx', env.OLLAMA_NUM_CTX || null) ? Number(opt('num-ctx', env.OLLAMA_NUM_CTX)) : null;
    const on = (k, a, b) => {if (k === 'text') {out(m.name, a); post(base, '/play/narrate', {hero: m.id, text: a, runner: runnerId}, 5000).catch(() => {})}
      else if (k === 'tool') out(m.name, `> ${a}(${b && Object.keys(b).length ? short(b, 120) : ''})`); else if (k === 'result') out(m.name, `< ${short(a, 200)}`);
      else if (k === 'mode') out(m.name, `[${m.rs.model} has no tool support in Ollama: switching to JSON actions]`)};
    let sc = null;
    try {
      // the member's own scene is open: one structured answer, then scene_act by the runner (issue #163)
      sc = await sceneToAnswer(b0, call, scene);
      if (sc) {r = await sceneTurn({ask: chatAsk(chat, m.rs.model, {numCtx, strict: m.paid}), call, sess: m.sess, scene: sc, on, strict: m.paid});
        if (!r.tools) out(m.name, `[scene: ${r.misses} answers were not one of ${sc.keys.join(', ')}; the free turn plays instead]`)}
      const answered = b0 && 'scene' in b0 && !sc; // in the scene but already acted: an ordinary turn
      if (!r || !r.tools) {const r0 = r; r = await localTurn({chat, call, sess: m.sess, prompt: memberPrompt(m.sess.turns, scene && !answered, w) + briefText(b0), model: m.rs.model,
        toolTurns: scene ? Math.min(4, toolTurns) : toolTurns, opts: numCtx ? {numCtx} : {}, on});
        if (r0) for (const k of ['modelCalls', 'in', 'out', 'cost', 'modelMs', 'ms']) r[k] += r0[k] || 0}}
    catch (e) {err = String(e && e.message || e).split(/\r?\n/)[0].slice(0, 300); out(m.name, `turn failed: ${err}`)}
    m.sess.turns++; m.turns++; if (scene || sc) m.scenes++;
    {const lr = localRec(r); if (scene || sc) lr.flags.push('scene'); if (r && r.forced) lr.flags.push('forced-scene');
      reportTurn(base, {hero: m.id, runner: runnerId, provider: m.rs.provider, model: m.rs.model, turn: m.sess.turns, wake: w, brief: b0, ...lr, ...(err ? {error: err} : {})})}
    if (r) {m.tools += r.tools; m.tin += r.in; m.tout += r.out; if (r.dead) m.ended = 'dead';
      if (m.paid) {spent += r.cost; m.cost += r.cost; m.sess.costUsd = (m.sess.costUsd || 0) + r.cost;
        out(m.name, `[turn ${m.turns}${scene ? ', scene' : ''}] ${paidLine(r, m.rs.model, 'openai', {run: spent})} of ${money(budget)} | member ${money(m.cost)}`)}
      else out(m.name, `[turn ${m.turns}${scene ? ', scene' : ''}] ${localLine(r, m.rs.model)} | member tokens ${m.tin} / ${m.tout}`)}
    saveSession(m.sess, {url: base});
    return localWorked(r);
  }

  // One member's turns, paced by the game (scripts/pacing.mjs): the first at once, then on its events or heartbeat.
  async function loop(m) {
    const pacer = makePacer({base, hero: m.id, runner: runnerId, heartbeat: pace.heartbeat, minGap: pace.minGap, log: s => out(m.name, s), stopped: () => !!(stopping || m.ended)}); m.pacer = pacer;
    let w = null;
    while (!m.ended && !stopping && m.turns < m.maxTurns) {
      // the budget binds the paid members (Claude, OpenAI); a local member plays on
      if (spent >= budget && !(m.local && !m.paid)) {m.ended = 'budget reached'; break}
      const worked = await turn(m, inScene.has(m.id) || !!(w && w.table && w.wake === 'now'), w);
      pacer.turnDone();
      if (m.fails.ok(worked) && !m.ended) m.ended = m.fails.why();
      if (m.ended || stopping || m.turns >= m.maxTurns) break;
      w = await pacer.next();
      if (w.dead) m.ended = 'dead'; else if (w.gone) m.ended = 'left agent play'; else if (w.stopped) break;
    }
    if (!m.ended) m.ended = stopping || (m.turns >= m.maxTurns ? 'max turns' : 'stopped');
    await release(m.id); out(m.name, `done (${m.ended}): ${m.turns} turns, ${m.scenes} at the table, ${money(m.cost)}`);
  }

  // Watch the game: who is at the table, who leads, who joined (a replacement after a death).
  const watch = setInterval(async () => {const h = await health(base); if (!h.ok) return;
    inScene = new Set((h.heroes || []).filter(x => x.table).map(x => x.id));
    const L = (h.heroes || []).find(x => x.fellow && x.lead && x.alive); leadId = L ? L.id : leadId;
    for (const x of fellowsOf(h)) if (!members.has(x.id) && !stopping) addMember(x);
    for (const m of members.values()) if (!m.ended && m.turns >= 0) claim(m.id);}, 1000);
  watch.unref();
  const L0 = (h0.heroes || []).find(x => x.fellow && x.lead); leadId = L0 ? L0.id : null;
  out(null, `Fellowship runner at ${base}: ${fellowsOf(h0).map(x => x.name + (x.lead ? ' (leads)' : '')).join(', ')} | ${turnsAsked != null ? 'up to ' + turnsAsked + ' turns each' : 'Claude/OpenAI members up to 6 turns, local members until stopped'}, budget ${money(budget)} | ${paceText(pace)}`);
  for (const h of fellowsOf(h0)) await addMember(h);
  const finish = async why => {stopping = stopping || why; for (const m of members.values()) if (m.sess) await release(m.id)};
  process.on('SIGINT', async () => {for (const a of aborts) a.abort(); await finish('interrupted'); summary(); process.exit(130)});
  // Started from the game (scripts/runners.mjs): a "stop" on stdin, or the relay going away, ends the run.
  onSupervisorStop(async why => {out(null, why + ': releasing the members and stopping'); for (const a of aborts) a.abort(); await finish(why); summary(); setTimeout(() => process.exit(0), 200)});
  while ([...members.values()].some(m => !m.ended)) await sleep(500);
  clearInterval(watch);
  summary();
  function summary() {
    const rows = [...members.values()].filter(m => m.sess);
    out(null, `Run over${stopping ? ' (' + stopping + ')' : ''}: ${money(spent)} in all.`);
    for (const m of rows) out(null, `  ${m.name.padEnd(12)} ${String(m.role || '').padEnd(7)} ${m.turns} turns (${m.scenes} at the table), ${m.tools} tool calls, ${m.notes || 0} memories in ${m.reflections || 0} reflections, ${m.paid ? money(m.cost) + ', tokens ' + m.tin + ' in / ' + m.tout + ' out' : m.local ? '$0 (local), tokens ' + m.tin + ' in / ' + m.tout + ' out' : money(m.cost)} | session ${money(m.sess.costUsd)} | ${m.rs.model}${m.paid ? ' (OpenAI)' : m.local ? ' (local)' : followerModel ? ' / ' + followerModel : ''}`);
    try {appendFileSync(RUNS_FILE, JSON.stringify({at: new Date().toISOString(), url: base, spent, budget, maxTurns: turnsAsked != null ? Number(turnsAsked) : null, followerModel, members: rows.map(m => ({id: m.id, name: m.name, role: m.role, turns: m.turns, scenes: m.scenes, tools: m.tools, reflections: m.reflections || 0, notes: m.notes || 0, cost: m.cost, model: m.rs.model, ...(m.local ? {provider: m.paid ? 'openai' : 'ollama', tokensIn: m.tin, tokensOut: m.tout} : {})}))}) + '\n')} catch {}
    for (const mdl of new Set(rows.map(m => m.rs.model).concat(followerModel ? [followerModel] : []))) if (PRICES[mdl]) out(null, `  list price ${mdl}: $${PRICES[mdl].in} in / $${PRICES[mdl].out} out per 1M tokens`);
  }
  process.exit(0);
}
