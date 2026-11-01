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
// Scheduling: every member runs its own loop of turns (one query() each). Between scenes a member
// rests --cadence seconds between turns (travel, rest, shopping and journaling need few calls);
// the moment the game reports the member at a Table mode scene (/play/health heroes[].table),
// its next turn starts at once with a prompt to act with scene_act. A silent or slow agent never
// stalls the table: the game gives every turn a real-time budget and then acts by reflex.
// Cost controls: one overall --budget for the run (each query gets what is left; several members
// may finish a turn in flight just past it), --max-turns per member, and --follower-model (for
// example claude-haiku-5-5) for members other than the leader between scenes; in scenes and for
// the leader the member's own model plays.
//
// Logs: everything goes to the console and to logs/fellowship.log (one line per event, the
// member's name first); a run summary with per-member cost is appended to logs/fellowship-runs.jsonl.
// Options: --url (or PLAY_URL), --max-turns N (per member, default 6), --budget USD (default 2.00),
// --model / --effort / --provider (override every member's saved settings), --follower-model M,
// --cadence S (default 20), --tool-turns N (model calls per turn, default 10), --env FILE, --new.
import {mkdirSync, appendFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join, resolve} from 'node:path';
import {hostname} from 'node:os';
import {query} from '@anthropic-ai/claude-agent-sdk';
import {loadEnv, PRICES} from './relay.mjs';
import {systemPrompt, DEFAULT_AGENT_MODEL} from './agent-player.mjs';
import {migrateLegacy, loadSession, saveSession, runnerSettings, DEFAULT_PROVIDER} from './agent-sessions.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOG_FILE = join(ROOT, 'logs', 'fellowship.log'), RUNS_FILE = join(ROOT, 'logs', 'fellowship-runs.jsonl');

// The Fellowship's part of a member's standing orders (appended to systemPrompt(status)).
export function fellowshipPrompt(st) {
  const f = st.fellowship || {};
  return [
    '',
    `FELLOWSHIP: you ride with ${f.fellowship || 'a Fellowship'} as its ${f.role || 'member'}. Four companions share your one road; their names, roles and how you see them are in status.fellowship.companions. status.fellowship also holds your voice, wants, fears, quirk, a line you would never say, your backstory and your memories: play from them, in that voice.`,
    '- Talk to your companions with party_say (they hear you wherever they are) and catch up with party_read. Keep it short and in character.',
    '- Decisions that need everyone (take a job, answer a Crypt or raid call, split up) go through propose(kind, details) and vote(proposal_id, yes|no, reason). Vote on every open proposal (status.proposals, or an event) with a reason in your own voice.',
    '- The leader (status.party_leader) chooses where the party goes with lead_to; everyone else follows. If you are the leader, lead: pick hunting grounds and jobs that suit the weakest of you. leave_party splits you off for a while and costs you the others\' trust; do it only for a reason your character would have.',
    '- TABLE MODE: when status, look or wait show "table", the world is paused for a scene and every second counts. Act at once with scene_act(option, line), using one of the options listed, with a short line in your voice. Do not look around first. You may answer as soon as the scene opens; it happens on your turn. Then wait.',
    '- Hardcore still holds: one life each. Protect each other.',
  ].join('\n');
}

const argv = process.argv.slice(2);
const opt = (k, d) => {const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] != null && !argv[i + 1].startsWith('--') ? argv[i + 1] : d};
const flag = k => argv.includes('--' + k);
const post = (base, path, body, ms) => fetch(base + path, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body), signal: AbortSignal.timeout(ms)});
const play = async (base, hero, tool, args = {}) => (await post(base, '/play/call', {hero, tool, args}, 90000)).json();
const health = base => fetch(base + '/play/health', {signal: AbortSignal.timeout(5000)}).then(r => r.json()).catch(e => ({error: e.message}));
const short = (v, n = 160) => {const s = typeof v === 'string' ? v : JSON.stringify(v); return s.length > n ? s.slice(0, n) + '…' : s};
const money = v => '$' + (v || 0).toFixed(4);
const sleep = ms => new Promise(r => setTimeout(r, ms));

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const envFile = opt('env', null), env = envFile ? loadEnv(dirname(resolve(envFile))) : loadEnv();
  const base = String(opt('url', env.PLAY_URL || 'http://127.0.0.1:8787')).replace(/\/$/, '');
  const maxTurns = Math.max(1, Number(opt('max-turns', 6))), budget = Math.max(.01, Number(opt('budget', 2))), toolTurns = Math.max(2, Number(opt('tool-turns', 10)));
  const cadence = Math.max(0, Number(opt('cadence', 20))) * 1000, followerModel = opt('follower-model', env.FELLOWSHIP_FOLLOWER_MODEL || null);
  mkdirSync(join(ROOT, 'logs'), {recursive: true});
  const out = (who, text) => {const line = `[${new Date().toISOString().slice(11, 19)}] ${who ? '[' + who + '] ' : ''}${text}`; console.log(line); try {appendFileSync(LOG_FILE, line + '\n')} catch {}};

  const h0 = await health(base);
  if (!h0.ok || !h0.connected) {console.error(`The game at ${base} is not ready: ${h0.error || 'no game page connected'}.`); process.exit(1)}
  const fellowsOf = h => (h.heroes || []).filter(x => x.fellow && x.alive);
  if (!fellowsOf(h0).length) {console.error('No agent-played Fellowship member. In the game, set the Fellowship panel\'s Minds to "agents" (or run play-headless with --fellowship).'); process.exit(1)}
  if (!env.ANTHROPIC_API_KEY) {console.error('No ANTHROPIC_API_KEY in the environment or .env (use --env FILE).'); process.exit(1)}
  const moved = migrateLegacy(); if (moved) out(null, moved);

  const runnerId = `${hostname()}:${process.pid}:fellowship`, childEnv = {...process.env, ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY, CLAUDE_AGENT_SDK_CLIENT_APP: 'eldmoor-fellowship/1.0'};
  delete childEnv.CLAUDECODE; delete childEnv.CLAUDE_CODE_ENTRYPOINT;
  const members = new Map(); // heroId -> {id, name, sess, rs, turns, cost, ended, scene}
  let spent = 0, stopping = null, inScene = new Set(), leadId = null;
  const claim = id => post(base, '/play/claim', {hero: id, runner: runnerId}, 5000).then(async r => ({status: r.status, ...(await r.json())})).catch(e => ({status: 0, error: e.message}));
  const release = id => post(base, '/play/release', {hero: id, runner: runnerId}, 3000).catch(() => {});

  async function addMember(h) {
    if (members.has(h.id)) return;
    const c = await claim(h.id); if (c.status !== 200) {out(h.name, 'skipped: ' + (c.error || 'could not claim')); members.set(h.id, {id: h.id, name: h.name, ended: 'claimed elsewhere'}); return}
    const st = await play(base, h.id, 'status'); if (!st.ok) {out(h.name, 'status failed: ' + st.error); await release(h.id); return}
    const sys = systemPrompt(st) + '\n' + fellowshipPrompt(st);
    const {sess, note} = loadSession(h.id, st.name, () => ({sessionId: null, heroId: h.id, heroName: st.name, system: sys, turns: 0, costUsd: 0, lastTotal: 0}), {startNew: flag('new')});
    if (note) out(st.name, note);
    if (!String(sess.system || '').includes('FELLOWSHIP:')) sess.system = sys; // a hero first played solo now rides with the Fellowship
    const {runner: rs} = runnerSettings(sess, {provider: opt('provider', null), model: opt('model', null), effort: opt('effort', null)},
      {provider: env.AGENT_PROVIDER || DEFAULT_PROVIDER, model: env.AGENT_MODEL || DEFAULT_AGENT_MODEL, effort: env.AGENT_EFFORT || 'medium'});
    if (rs.provider !== 'anthropic') {out(st.name, `provider "${rs.provider}" is not supported yet (see the Mixed minds issue); skipped`); await release(h.id); return}
    sess.runner = rs; saveSession(sess, {url: base});
    const m = {id: h.id, name: st.name, role: (st.fellowship || {}).role || h.role, sess, rs, turns: 0, cost: 0, tools: 0, ended: null, scenes: 0};
    members.set(h.id, m);
    out(m.name, `${m.role || 'member'}, level ${st.level} ${st.cls} | ${rs.model} (effort ${rs.effort})${followerModel ? ', ' + followerModel + ' between scenes when following' : ''} | ${sess.sessionId ? 'resuming ' + sess.sessionId : 'new session'}`);
    loop(m).catch(e => {m.ended = 'error: ' + e.message; out(m.name, 'loop failed: ' + e.message)});
  }

  // One turn: one query() to the member's own session.
  async function turn(m, scene) {
    const model = scene || m.id === leadId || !followerModel ? m.rs.model : followerModel;
    const prompt = scene ? 'The Fellowship is at the table: a scene is open and the world is paused. Read the table (status, or the event you were sent) only if you must, then act NOW with scene_act(option, line). Then wait.'
      : m.sess.turns === 0 ? 'Begin. Get to know yourself, your companions and your surroundings (status, look, party_read, journal_read), say a word to the party, write a first journal entry, then act. Follow your leader.'
      : `Turn ${m.sess.turns + 1}. Carry on with your companions: answer open proposals, keep to the party, and act.`;
    const t0 = Date.now(); let result = null, tools = 0;
    const q = query({prompt, options: {
      model, effort: m.rs.effort, systemPrompt: m.sess.system, resume: m.sess.sessionId || undefined,
      mcpServers: {eldmoor: {type: 'http', url: `${base}/mcp?hero=${m.id}`, headers: {'X-Eldmoor-Hero': String(m.id)}, timeout: 90000}},
      tools: [], allowedTools: ['mcp__eldmoor'], permissionMode: 'dontAsk', settingSources: [],
      settings: {autoCompactEnabled: true}, maxTurns: scene ? Math.min(4, toolTurns) : toolTurns, maxBudgetUsd: Math.max(.01, budget - spent),
      cwd: join(ROOT, 'logs'), env: childEnv,
    }});
    try {for await (const msg of q) {
      if (msg.type === 'system' && msg.subtype === 'init') {m.sess.sessionId = msg.session_id; saveSession(m.sess, {url: base})}
      else if (msg.type === 'system' && msg.subtype === 'compact_boundary') out(m.name, `[compacted: ${msg.compact_metadata.pre_tokens} -> ${msg.compact_metadata.post_tokens ?? '?'} tokens]`);
      else if (msg.type === 'assistant' && !msg.parent_tool_use_id) {
        for (const b of msg.message.content || []) {
          if (b.type === 'text' && b.text.trim()) {out(m.name, b.text.trim()); post(base, '/play/narrate', {hero: m.id, text: b.text.trim()}, 5000).catch(() => {})}
          else if (b.type === 'tool_use') {tools++; out(m.name, `> ${String(b.name).replace(/^mcp__eldmoor__/, '')}(${b.input && Object.keys(b.input).length ? short(b.input, 120) : ''})`)}
        }
      } else if (msg.type === 'user' && Array.isArray(msg.message?.content)) {
        for (const b of msg.message.content) if (b.type === 'tool_result') {const c = Array.isArray(b.content) ? b.content.map(x => x.text || '').join('') : String(b.content || ''); out(m.name, `< ${short(c, 200)}`);
          if (/"dead":true/.test(c)) m.ended = 'dead'}
      } else if (msg.type === 'result') result = msg;
    }} catch (e) {
      if (result && result.subtype === 'error_max_turns') out(m.name, `turn hit the model-call cap; continuing next turn`);
      else {out(m.name, `turn failed: ${String(e && e.message || e).split(/\r?\n/)[0].slice(0, 300)}`); m.fails = (m.fails || 0) + 1; if (m.fails >= 3) m.ended = 'errors'}}
    m.sess.turns++; m.turns++; m.tools += tools; if (scene) m.scenes++;
    if (result) {
      const tot = result.total_cost_usd || 0, cost = tot >= m.sess.lastTotal ? tot - m.sess.lastTotal : tot; m.sess.lastTotal = tot;
      spent += cost; m.cost += cost; m.sess.costUsd += cost;
      const mu = Object.values(result.modelUsage || {}), tin = mu.reduce((t, u) => t + u.inputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens, 0), tout = mu.reduce((t, u) => t + u.outputTokens, 0), cached = mu.reduce((t, u) => t + u.cacheReadInputTokens, 0);
      out(m.name, `[turn ${m.turns}${scene ? ', scene' : ''}] ${model} | ${tools} tool calls, ${((Date.now() - t0) / 1000).toFixed(1)} s | tokens in ${tin} (${cached} cached) / out ${tout} | turn ${money(cost)} | member ${money(m.cost)} | run ${money(spent)} of ${money(budget)}`);
    }
    saveSession(m.sess, {url: base});
  }

  async function loop(m) {
    while (!m.ended && !stopping && m.turns < maxTurns) {
      if (spent >= budget) {stopping = 'budget reached'; break}
      await turn(m, inScene.has(m.id));
      if (m.ended || stopping) break;
      // between scenes: a slower cadence, cut short the moment a scene opens for this member
      for (let t = 0; t < cadence && !inScene.has(m.id) && !stopping; t += 1000) await sleep(1000);
    }
    if (!m.ended) m.ended = stopping || (m.turns >= maxTurns ? 'max turns' : 'stopped');
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
  out(null, `Fellowship runner at ${base}: ${fellowsOf(h0).map(x => x.name + (x.lead ? ' (leads)' : '')).join(', ')} | up to ${maxTurns} turns each, budget ${money(budget)}, cadence ${cadence / 1000} s`);
  for (const h of fellowsOf(h0)) await addMember(h);
  const finish = async why => {stopping = stopping || why; for (const m of members.values()) if (m.sess) await release(m.id)};
  process.on('SIGINT', async () => {await finish('interrupted'); summary(); process.exit(130)});
  while ([...members.values()].some(m => !m.ended)) await sleep(500);
  clearInterval(watch);
  summary();
  function summary() {
    const rows = [...members.values()].filter(m => m.sess);
    out(null, `Run over${stopping ? ' (' + stopping + ')' : ''}: ${money(spent)} in all.`);
    for (const m of rows) out(null, `  ${m.name.padEnd(12)} ${String(m.role || '').padEnd(7)} ${m.turns} turns (${m.scenes} at the table), ${m.tools} tool calls, ${money(m.cost)} | session ${money(m.sess.costUsd)} | ${m.rs.model}${followerModel ? ' / ' + followerModel : ''}`);
    try {appendFileSync(RUNS_FILE, JSON.stringify({at: new Date().toISOString(), url: base, spent, budget, maxTurns, followerModel, members: rows.map(m => ({id: m.id, name: m.name, role: m.role, turns: m.turns, scenes: m.scenes, tools: m.tools, cost: m.cost, model: m.rs.model}))}) + '\n')} catch {}
    for (const mdl of new Set(rows.map(m => m.rs.model).concat(followerModel ? [followerModel] : []))) if (PRICES[mdl]) out(null, `  list price ${mdl}: $${PRICES[mdl].in} in / $${PRICES[mdl].out} out per 1M tokens`);
  }
  process.exit(0);
}
