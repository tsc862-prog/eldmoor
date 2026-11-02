// The DM agent runner (issue #66, part 1): `npm run dm` sits an AI agent in the DM seat. Between
// scenes it reads the world (timeline, chronicle, its DM log, the Fellowship with personas,
// memories and open threads, heroes and parties, people, regions, hooks and levers), keeps its
// campaign notes (saved with the world) and shapes what comes next through the validated world
// levers (pulled with by:'dm-agent': limits, cooldowns and DM log entries apply). It never controls
// a hero and never kills anyone by fiat; the scripted DM keeps running alongside it, unchanged.
//
//   1. npm run relay   (+ npm run dev; in the game open the Dungeon Master panel and press "DM agent")
//      or: node scripts/play-headless.mjs --dm --agents 0   (a Node world with the DM seat open, port 8789)
//   2. npm run dm [-- --url http://127.0.0.1:8789] [--max-turns 12] [--budget 1.00] [--cadence evening]
//
// The runner claims the one DM seat at the relay (POST /play/claim {role:'dm'}, refreshed every
// 10 s, released on exit; a second DM runner is refused) and every tool call names the role
// (X-Eldmoor-Role: dm on the MCP connection, POST /play/dm without MCP).
// Cadence: one turn now, then one every game evening (18:00) by default, or every --cadence S real
// seconds; a turn never starts while a Table scene or a party vote is open (that is part 2's at-
// the-table work). One model call at a time (the owner's API concurrency is low); a rate limit (429
// or overloaded) backs off 30 s, 60 s, ... up to 10 min and retries the turn. Turns are also at least
// --min-gap S real seconds apart (issue #126; default 20, AGENT_MIN_GAP), so a fast world (8x: a game day
// in 30 s) gets a DM turn now and then, not back to back. A local (Ollama) DM runs until stopped unless
// --max-turns is given; any DM stops after --max-fails N (default 5) failed or empty turns in a row.
// Session: logs/agents/dm.json (gitignored), resumed next run for the same world; --new sets it
// aside in logs/agents/old/. Cost line per turn.
//
// Options: --url (or PLAY_URL; default http://127.0.0.1:8787), --max-turns N (default 12 for Claude; a local
// DM until stopped), --min-gap S, --max-fails N, --budget USD
// (default 1.00, this run), --cadence evening|S, --tool-turns N (model calls per turn, default 16),
// --provider anthropic|ollama (or DM_PROVIDER), --model (or DM_MODEL; default claude-sonnet-5-5, or the
// Ollama default), --effort (default medium), --ollama-url, --num-ctx, --env FILE, --new.
// --claude-concurrency is accepted (the runner supervisor passes it) and changes nothing: always one call.
import {mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join, resolve} from 'node:path';
import {hostname} from 'node:os';
import {DM_TOOLS} from '../src/data/dm-tools.js';
import {loadDmSession, saveDmSession, dmSessionPath, runnerSettings, DEFAULT_PROVIDER} from './agent-sessions.mjs';
import {onSupervisorStop} from './runners.mjs';
import {reportTurn, localRec, turnCollector} from './behavior-turn.mjs'; // behavior logs (issue #129)
import {paceSettings, turnCap, capText, failTracker, localWorked, takeClaudeSlot} from './pacing.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DM_PROVIDERS = ['anthropic', 'ollama'];
export const DEFAULT_DM_MODEL = 'claude-sonnet-5-5'; // claude-api skill (cached 2026-10-06): Sonnet 5.5, $2 in / $10 out per 1M tokens
export const EVENING = 18 * 60, DAY = 1440, POLL_MS = 4000, BACKOFF = [30, 60, 120, 240, 600];

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
    '- Hardcore is sacred: one life. Do not pile danger onto a badly hurt party; give them a road home. Danger should be readable (a rumour, a marked road, a wary innkeeper) before it bites.',
    '- Change the world with pull_lever only, with a one-sentence reason (the watcher reads it in the DM log). Few, deliberate pulls: 1-3 a turn is plenty; none is fine when the story is already moving. Levers have limits and cooldowns; a refusal is information, not an error to fight.',
    '- The scripted DM keeps posting jobs and running adventures beside you. Build on what it does; do not flood the boards.',
    '- Keep notes: open threads (unresolved things), characters (recurring people and their wants), plans (what you are setting up), secrets (what the heroes do not know yet). Read them back at the start of a turn and keep them current; they are your memory.',
    '- Use log_intent for one line of what you are preparing and why, when you set something up.',
    '- You speak to the heroes only inside the game: narrate (a line of description the heroes near a place hear and see) and npc_say (a person in the world says something). Your notes, log_intent lines and lever reasons are private to you and the watcher; no hero ever reads them, and you never message a player directly. Speak sparingly: a few lines a day, about what can be seen and heard, never what a hero thinks or must do.',
    '- If dm_status shows a Table scene or an open vote, read only and end the turn.',
    '- Original world only: invent names in Eldmoor\'s own voice; never borrow names from other games or books.',
    '',
    'Each turn: dm_status, notes_read, then look where the story is (fellowship_view, read_timeline, read_dm_log, hooks, heroes_near, npcs, regions, levers as needed), update notes, pull at most a few levers, and end with one short sentence of what you prepared.',
  ].join('\n');
}
export const dmTurnPrompt = (turns, st) => turns === 0
  ? 'You take the DM seat. Orient yourself: dm_status, fellowship_view, notes_read, levers, read_timeline. Write your first notes (threads, characters, plans), then make at most two changes to the world if they serve the story.'
  : `Day ${st.day}, ${st.time} (${st.part}). ${st.since_last_look ? `Since your last look: ${st.since_last_look.timeline} timeline events, ${st.since_last_look.dm_log} DM log entries.` : ''} Prepare the next stretch of the campaign.`;

const post = (base, path, body, ms) => fetch(base + path, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body), signal: AbortSignal.timeout(ms)});
// Every DM call names the role and this runner (the id it claimed the seat with), issue #123.
let RUNNER = null;
export async function dmTool(base, tool, args = {}) {try {return await (await post(base, '/play/dm', {tool, args, role: 'dm', runner: RUNNER}, 20000)).json()} catch (e) {return {ok: false, error: e.message, offline: true}}}
const short = (v, n = 160) => {const s = typeof v === 'string' ? v : JSON.stringify(v); return s.length > n ? s.slice(0, n) + '…' : s};
const money = v => '$' + (v || 0).toFixed(4);
const sleep = ms => new Promise(r => setTimeout(r, ms));
// The game minute a turn may start after, for a cadence: the next evening, or null (real seconds).
export const nextEvening = gm => {const d = Math.floor(gm / DAY), e = d * DAY + EVENING; return gm < e ? e : e + DAY};
export const isRateLimit = s => /\b429\b|rate.?limit|overloaded|\b529\b/i.test(String(s || ''));

// Wait until the cadence allows a turn and nothing is pending. Returns the fresh status, or null on stop.
// gapUntil: the earliest real time (ms) the next turn may start (the minimum gap, issue #126).
async function waitTurn({base, cadence, lastGm, log, stopped, gapUntil = 0}) {
  const target = cadence === 'evening' && lastGm != null ? nextEvening(lastGm) : null, until = Math.max(gapUntil, cadence !== 'evening' && lastGm != null ? Date.now() + Number(cadence) * 1000 : 0);
  let said = '';
  for (;;) {
    if (stopped()) return null;
    const st = await dmTool(base, 'dm_status');
    let why = '';
    if (!st.ok) why = st.offline ? 'the game is not answering (' + short(st.error, 90) + ')' : short(st.error, 90);
    else if (target != null && st.gameMin < target) why = `waiting for the evening of day ${Math.floor(target / DAY) + 1} (now day ${st.day} ${st.time})`;
    else if (until && Date.now() < until) why = `next turn in ${Math.ceil((until - Date.now()) / 1000)} s`;
    else if (st.pending) why = st.table && st.table.open ? 'a Table scene is running' : 'a party vote is open';
    if (!why) return st;
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
  if (!health.dm || !health.dm.seat) {console.error('[dm] The DM seat is closed. In the game, open the Dungeon Master panel and press "DM agent" (or start play-headless with --dm).'); process.exit(1)}
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
  const {sess, note} = loadDmSession(st0.world, () => ({sessionId: null, world: st0.world, system: dmSystemPrompt(st0), turns: 0, costUsd: 0, lastTotal: 0, lastGm: null}), {startNew: flag('new')});
  if (note) log('[dm] ' + note);
  const {runner: rs} = runnerSettings(sess, {provider: opt('provider', null), model: opt('model', null), effort: opt('effort', null)},
    {provider: env.DM_PROVIDER || DEFAULT_PROVIDER, model: env.DM_MODEL || DEFAULT_DM_MODEL, effort: env.DM_EFFORT || 'medium'});
  if (!DM_PROVIDERS.includes(rs.provider)) {console.error(`[dm] provider "${rs.provider}" has no DM runner. Use --provider anthropic or --provider ollama.`); await quit(1)}
  const saveSess = () => saveDmSession(sess, {url: base});
  let spent = 0, ended = null, runIn = 0, runOut = 0, backoff = 0, lastEnd = 0;
  const maxTurns = turnCap(turnsAsked, rs.provider, 12), fails = failTracker(pace.maxFails), gapUntil = () => lastEnd ? lastEnd + pace.minGap * 1000 : 0;
  const t00 = Date.now();

  if (rs.provider === 'ollama') {
    // A local model sits in the seat (Mixed minds): the tool loop of scripts/local-agent.mjs over the DM tools. No key, cost 0.
    const {ollamaAdapter, OLLAMA_URL, OLLAMA_MODEL} = await import('./providers/ollama.mjs');
    const {localTurn, localLine} = await import('./local-agent.mjs');
    if (!opt('model', null) && rs.model && /^claude-/.test(rs.model)) rs.model = null;
    rs.model = rs.model || env.OLLAMA_MODEL || OLLAMA_MODEL; rs.effort = null; sess.runner = rs; mind = {provider: 'ollama', model: rs.model}; await claim();
    const ol = ollamaAdapter({url: opt('ollama-url', env.OLLAMA_URL || OLLAMA_URL), defaultModel: rs.model}), s0 = await ol.status();
    if (!s0.ok) {console.error(`[dm] Ollama at ${s0.url} is ${s0.error}. Start Ollama or pass --ollama-url.`); await quit(1)}
    if (!s0.models.includes(rs.model)) {console.error(`[dm] model ${rs.model} is not pulled in Ollama (pulled: ${s0.models.join(', ') || 'none'}). Run: ollama pull ${rs.model}, or pick one with --model.`); await quit(1)}
    log(`[dm] DM seat taken | local model ${rs.model} via Ollama | ${sess.local && sess.local.history && sess.local.history.length ? 'resuming' : 'new session'} | ${capText(maxTurns)}, cadence ${cadence}, at least ${pace.minGap} s apart`);
    const numCtx = opt('num-ctx', env.OLLAMA_NUM_CTX || null);
    const rules = '\n\nHow your turns work here: call one tool at a time and read its result before the next. When you are done for this turn, reply with one short sentence of what you prepared, in plain text (no tool call).';
    for (let turn = 1; turn <= maxTurns && !ended; turn++) {
      const st = await waitTurn({base, cadence, lastGm: sess.turns ? sess.lastGm : null, log, stopped: () => stopping, gapUntil: gapUntil()}); if (!st) {ended = 'the seat closed'; break}
      let r = null, err = null;
      try {r = await localTurn({chat: ol.chat, call: (tool, args) => dmTool(base, tool, args), sess, prompt: dmTurnPrompt(sess.turns, st), model: rs.model, toolTurns, tools: DM_TOOLS, rules,
        opts: {...(numCtx ? {numCtx: Number(numCtx)} : {}), endOnWait: false},
        on: (k, a, b) => {if (k === 'text') log(`  DM: ${a}`); else if (k === 'tool') log(`  > ${a}(${b && Object.keys(b).length ? short(b, 120) : ''})`); else if (k === 'result') log(`    < ${short(a, 220)}`)}})}
      catch (e) {err = String(e && e.message || e).split(/\r?\n/)[0].slice(0, 300); console.error(`[dm] turn failed: ${err}`)}
      sess.turns++; sess.lastGm = st.gameMin; lastEnd = Date.now();
      reportTurn(base, {role: 'dm', runner, provider: 'ollama', model: rs.model, turn: sess.turns, gameMin: st.gameMin ?? null, ...localRec(r), ...(err ? {error: err} : {})});
      if (r) {runIn += r.in; runOut += r.out; log(`[turn ${sess.turns}] ${localLine(r, rs.model)}`)}
      saveSess();
      if (fails.ok(localWorked(r))) ended = fails.why();
    }
    clearInterval(beat); await release();
    log(`[dm] stopped after ${sess.turns} turns this session${ended ? ' (' + ended + ')' : ''}; this run ${runIn} tokens in / ${runOut} out in ${((Date.now() - t00) / 1000).toFixed(0)} s, $0 (local). Session saved to ${dmSessionPath()}.`);
    process.exit(0);
  }

  if (!env.ANTHROPIC_API_KEY) {console.error('[dm] No ANTHROPIC_API_KEY in the environment or .env (use --env FILE), or play the DM locally with --provider ollama.'); await quit(1)}
  const {query} = await import('@anthropic-ai/claude-agent-sdk');
  sess.runner = rs; mind = {provider: rs.provider, model: rs.model}; claim();
  const {model, effort} = rs;
  log(`[dm] DM seat taken | model ${model} (effort ${effort}) | ${sess.sessionId ? 'resuming session ' + sess.sessionId : 'new session'} | ${capText(maxTurns)}, budget ${money(budget)}, cadence ${cadence}, at least ${pace.minGap} s apart`);
  const childEnv = {...process.env, ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY, CLAUDE_AGENT_SDK_CLIENT_APP: 'eldmoor-dm-agent/1.0'};
  delete childEnv.CLAUDECODE; delete childEnv.CLAUDE_CODE_ENTRYPOINT;
  mkdirSync(join(ROOT, 'logs'), {recursive: true}); // the agent's working directory (it has no file tools)
  for (let turn = 1; turn <= maxTurns && !ended;) {
    if (spent >= budget) {ended = 'budget reached'; break}
    const st = await waitTurn({base, cadence, lastGm: sess.turns ? sess.lastGm : null, log, stopped: () => stopping, gapUntil: gapUntil()}); if (!st) {ended = 'the seat closed'; break}
    const t0 = Date.now(), tc = turnCollector(); let tools = 0, result = null, limited = false, failed = null;
    const freeSlot = await takeClaudeSlot(base, log, {stopped: () => stopping}); // under the app supervisor: one of the Claude slots for this turn
    turnAbort = new AbortController();
    const q = query({prompt: dmTurnPrompt(sess.turns, st), options: {
      abortController: turnAbort,
      model, effort, systemPrompt: sess.system, resume: sess.sessionId || undefined,
      mcpServers: {eldmoor: {type: 'http', url: `${base}/mcp?role=dm&runner=${encodeURIComponent(runner)}`, headers: {'X-Eldmoor-Role': 'dm', 'X-Eldmoor-Runner': runner}, timeout: 30000}},
      tools: [], allowedTools: ['mcp__eldmoor'], permissionMode: 'dontAsk', settingSources: [],
      settings: {autoCompactEnabled: true}, maxTurns: toolTurns, maxBudgetUsd: Math.max(.01, budget - spent),
      cwd: join(ROOT, 'logs'), env: childEnv,
    }});
    try {for await (const m of q) {
      if (m.type === 'system' && m.subtype === 'init') {sess.sessionId = m.session_id; saveSess()}
      else if (m.type === 'system' && m.subtype === 'api_retry') {if (m.error_status === 429 || m.error === 'rate_limit' || m.error === 'overloaded') {limited = true; log(`  [rate limited: the SDK retries in ${Math.round(m.retry_delay_ms / 1000)} s (attempt ${m.attempt}/${m.max_retries})]`)}}
      else if (m.type === 'system' && m.subtype === 'compact_boundary') log(`  [compacted: ${m.compact_metadata.pre_tokens} -> ${m.compact_metadata.post_tokens ?? '?'} tokens]`);
      else if (m.type === 'assistant' && !m.parent_tool_use_id) {
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
    freeSlot();
    let turnCost = null, tin = null, tout = null;
    if (result) {
      const tot = result.total_cost_usd || 0, cost = tot >= sess.lastTotal ? tot - sess.lastTotal : tot; sess.lastTotal = tot;
      spent += cost; sess.costUsd += cost; turnCost = cost;
      const mu = Object.values(result.modelUsage || {}), cached = mu.reduce((t, u) => t + u.cacheReadInputTokens, 0);
      tin = mu.reduce((t, u) => t + u.inputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens, 0); tout = mu.reduce((t, u) => t + u.outputTokens, 0);
      if (result.is_error && isRateLimit(JSON.stringify(result.errors || result.result || ''))) failed = failed || 'rate_limit';
      log(`[turn ${sess.turns + 1}] ${tools} tool calls, ${((Date.now() - t0) / 1000).toFixed(1)} s, ${result.num_turns} model calls | session tokens in ${tin} (${cached} cached) / out ${tout} | turn ${money(cost)} | run ${money(spent)} | session ${money(sess.costUsd)}${result.subtype !== 'success' ? ' | ' + result.subtype : ''}`);
    }
    reportTurn(base, {role: 'dm', runner, provider: rs.provider, model, turn: sess.turns + 1, gameMin: st.gameMin ?? null, tools: tc.tools, narration: tc.narration, seconds: +((Date.now() - t0) / 1000).toFixed(1), tokensIn: tin, tokensOut: tout, cost: turnCost,
      flags: result && result.subtype !== 'success' ? [result.subtype] : [], ...(failed ? {error: failed === 'rate_limit' || failed === 'overloaded' ? '429 ' + failed : failed} : {})});
    // A rate-limited turn that did nothing is retried after a growing pause; a turn that got work done counts.
    if (failed && failed !== 'error' && !tools) {const s = BACKOFF[Math.min(backoff, BACKOFF.length - 1)]; backoff++; log(`[dm] rate limited (${failed}); backing off ${s} s before trying the turn again`); saveSess(); await sleep(s * 1000); continue}
    backoff = 0; sess.turns++; sess.lastGm = st.gameMin; turn++; lastEnd = Date.now();
    saveSess();
    if (fails.ok(!failed && tools > 0)) ended = fails.why();
  }
  clearInterval(beat); await release();
  log(`[dm] stopped after ${sess.turns} turns this session${ended ? ' (' + ended + ')' : ''}; this run ${money(spent)}, session ${money(sess.costUsd)}. Session saved to ${dmSessionPath()}.`);
  process.exit(0);
}
