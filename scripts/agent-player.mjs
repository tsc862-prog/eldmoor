// Agent player runner (issue #75): `npm run agent` plays the agent-played hero with the Claude
// Agent SDK (@anthropic-ai/claude-agent-sdk), connected to the Eldmoor MCP tools.
//
//   1. npm run relay   (+ npm run dev, open the game, select a hero, press "Agent")
//      or: npm run play-headless           (a Node world, no browser; port 8789)
//   2. npm run agent -- [--url http://127.0.0.1:8787] [--max-turns 20] [--budget 1.00] [--new]
//
// One "turn" here is one query() to the agent: it looks, decides, acts, waits, and ends the turn
// with a line of narration; the runner prints the tool calls, the narration and a cost line, and
// starts the next turn. The session id is kept in logs/agent-session.json (gitignored) with the
// hero it belongs to, so the next run resumes the same conversation (--new starts afresh). Long
// sessions compact automatically (the Agent SDK's auto-compaction; boundaries are printed).
//
// Options: --url (or PLAY_URL; default http://127.0.0.1:8787), --max-turns N (default 20),
// --budget USD (default 1.00, total for this run), --tool-turns N (model round trips per turn,
// default 12), --model (or AGENT_MODEL; default claude-sonnet-5-5), --effort (or AGENT_EFFORT;
// default medium), --env FILE (a .env with ANTHROPIC_API_KEY; default the repo's .env), --new.
// The key is read from the environment or the .env file and handed only to the SDK process.
// The agent gets no built-in tools (no files, no shell, no web): only the game's MCP tools.
import {existsSync, readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join, resolve} from 'node:path';
import {query} from '@anthropic-ai/claude-agent-sdk';
import {loadEnv, PRICES} from './relay.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SESSION_FILE = join(ROOT, 'logs', 'agent-session.json');
export const DEFAULT_AGENT_MODEL = 'claude-sonnet-5-5'; // claude-api skill (cached 2026-10-06): Sonnet 5.5, $2 in / $10 out per 1M tokens

const argv = process.argv.slice(2);
const opt = (k, d) => {const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] != null && !argv[i + 1].startsWith('--') ? argv[i + 1] : d};
const flag = k => argv.includes('--' + k);

// The hero's standing orders. Built once per session from the hero's own status and kept with
// the session, so a resumed conversation sees the same system prompt.
export function systemPrompt(st) {
  const traits = (st.traits || []).join('; ');
  return [
    `You are ${st.name}, a level ${st.level} ${st.people} ${st.cls} of the ${st.faction}, from ${st.home}. You live in Eldmoor, a small 8-bit fantasy world that keeps running whether you act or not: other heroes quest, trade, feud and die around you.`,
    st.origin ? `Your past: ${st.origin}` : '',
    st.oath ? `Your oath: ${st.oath}.` : '',
    traits ? `Your nature: ${traits}. Let it colour your choices.` : '',
    '',
    'HARDCORE: you have one life. If you die, you are gone for good and your story ends. Fight things your level or below, rest or go home when hurt, and flee early rather than late. Reflexes protect you when you are slow (you break off below about 15% HP and defend yourself when attacked), but they are a last resort.',
    '',
    'How to play:',
    '- You act only through the tools. You know only what they tell you: what you can see nearby, what you hear, and the news.',
    '- Each turn: orient (status or look), decide, give ONE command (move_to, hunt, fight, rest, take_adventure, ...), then call wait (30-120 game minutes) to let it play out. Never spam actions; the world needs time to answer. When wait returns early, something needs you: read the events.',
    '- Grow stronger: hunt in your level band, sell loot and buy gear at home, hand in quests (turn_in), take adventures from the gate (list_jobs, take_adventure) once level 4+, answer scene choices with choose.',
    '- Keep a journal: after anything notable (a level, a near death, an adventure, a new friend or enemy), write 1-3 sentences with journal_write in your own voice. Read it back with journal_read when you resume.',
    '- Speak (say) sparingly and in character. Be fair to the world: this is a story, not a speedrun.',
    '- End every turn with one short sentence of narration in the third person about what you did and why.',
  ].filter(s => s !== null).join('\n');
}

async function play(base, tool, args = {}) {
  const r = await fetch(base + '/play/call', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({tool, args}), signal: AbortSignal.timeout(90000)});
  return r.json();
}
const narrate = (base, text) => fetch(base + '/play/narrate', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({text}), signal: AbortSignal.timeout(5000)}).catch(() => {});
const short = (v, n = 160) => {const s = typeof v === 'string' ? v : JSON.stringify(v); return s.length > n ? s.slice(0, n) + '…' : s};
const money = v => '$' + (v || 0).toFixed(4);

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const envFile = opt('env', null);
  const env = envFile ? loadEnv(dirname(resolve(envFile))) : loadEnv();
  const base = String(opt('url', env.PLAY_URL || 'http://127.0.0.1:8787')).replace(/\/$/, '');
  const maxTurns = Math.max(1, Number(opt('max-turns', 20))), budget = Math.max(.01, Number(opt('budget', 1))), toolTurns = Math.max(2, Number(opt('tool-turns', 12)));
  const model = opt('model', env.AGENT_MODEL || DEFAULT_AGENT_MODEL), effort = opt('effort', env.AGENT_EFFORT || 'medium');
  if (!env.ANTHROPIC_API_KEY) {console.error('No ANTHROPIC_API_KEY in the environment or .env (use --env FILE).'); process.exit(1)}

  const health = await fetch(base + '/play/health', {signal: AbortSignal.timeout(5000)}).then(r => r.json()).catch(e => ({error: e.message}));
  if (!health.ok || !health.connected || !health.hero) {console.error(`The game at ${base} is not ready: ${health.error || (!health.connected ? 'no game page connected' : 'no agent-played hero')}.`); process.exit(1)}
  const st = await play(base, 'status');
  if (!st.ok) {console.error('status failed: ' + st.error); process.exit(1)}

  let sess = null;
  try {sess = existsSync(SESSION_FILE) ? JSON.parse(readFileSync(SESSION_FILE, 'utf8')) : null} catch {sess = null}
  if (flag('new') || !sess || sess.heroId !== health.hero.id || sess.heroName !== st.name) sess = {sessionId: null, heroId: health.hero.id, heroName: st.name, system: systemPrompt(st), turns: 0, costUsd: 0, lastTotal: 0};
  const saveSess = () => {mkdirSync(dirname(SESSION_FILE), {recursive: true}); writeFileSync(SESSION_FILE, JSON.stringify({...sess, model, url: base, updated: new Date().toISOString()}, null, 1))};
  console.log(`[agent] ${st.name}, level ${st.level} ${st.cls} of the ${st.faction} | model ${model} (effort ${effort}) | ${sess.sessionId ? 'resuming session ' + sess.sessionId : 'new session'} | up to ${maxTurns} turns, budget ${money(budget)}`);

  const childEnv = {...process.env, ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY, CLAUDE_AGENT_SDK_CLIENT_APP: 'eldmoor-agent-player/1.0'};
  delete childEnv.CLAUDECODE; delete childEnv.CLAUDE_CODE_ENTRYPOINT;
  mkdirSync(join(ROOT, 'logs'), {recursive: true}); // the agent's working directory (it has no file tools)
  let spent = 0, ended = null;
  for (let turn = 1; turn <= maxTurns && !ended; turn++) {
    if (spent >= budget) {ended = 'budget reached'; break}
    const prompt = sess.turns === 0 ? 'Begin. Get to know yourself and your surroundings (status, look, journal_read), write a first journal entry, then act.'
      : `Turn ${sess.turns + 1}. Continue living your life in Eldmoor.`;
    const t0 = Date.now(); let tools = 0, result = null;
    const q = query({prompt, options: {
      model, effort, systemPrompt: sess.system, resume: sess.sessionId || undefined,
      mcpServers: {eldmoor: {type: 'http', url: base + '/mcp', timeout: 90000}},
      tools: [], allowedTools: ['mcp__eldmoor'], permissionMode: 'dontAsk', settingSources: [],
      settings: {autoCompactEnabled: true}, maxTurns: toolTurns, maxBudgetUsd: Math.max(.01, budget - spent),
      cwd: join(ROOT, 'logs'), env: childEnv,
    }});
    try {for await (const m of q) {
      if (m.type === 'system' && m.subtype === 'init') {sess.sessionId = m.session_id; saveSess()}
      else if (m.type === 'system' && m.subtype === 'compact_boundary') console.log(`  [compacted: ${m.compact_metadata.pre_tokens} -> ${m.compact_metadata.post_tokens ?? '?'} tokens]`);
      else if (m.type === 'assistant' && !m.parent_tool_use_id) {
        for (const b of m.message.content || []) {
          if (b.type === 'text' && b.text.trim()) {console.log(`  ${st.name}: ${b.text.trim()}`); narrate(base, b.text.trim())}
          else if (b.type === 'tool_use') {tools++; console.log(`  > ${String(b.name).replace(/^mcp__eldmoor__/, '')}(${b.input && Object.keys(b.input).length ? short(b.input, 120) : ''})`)}
        }
      } else if (m.type === 'user' && Array.isArray(m.message?.content)) {
        for (const b of m.message.content) if (b.type === 'tool_result') {const c = Array.isArray(b.content) ? b.content.map(x => x.text || '').join('') : String(b.content || ''); console.log(`    < ${short(c, 220)}`);
          if (/"dead":true/.test(c)) ended = 'the hero is dead'}
      } else if (m.type === 'result') result = m;
    }} catch (e) {console.error(`[agent] turn failed: ${String(e && e.message || e).split(/\r?\n/)[0].slice(0, 300)}`); ended = 'error'}
    sess.turns++;
    if (result) {
      // total_cost_usd is cumulative for the session when resumed; take the part this turn added.
      const tot = result.total_cost_usd || 0, cost = tot >= sess.lastTotal ? tot - sess.lastTotal : tot; sess.lastTotal = tot;
      spent += cost; sess.costUsd += cost;
      const mu = Object.values(result.modelUsage || {}), tin = mu.reduce((t, u) => t + u.inputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens, 0), tout = mu.reduce((t, u) => t + u.outputTokens, 0), cached = mu.reduce((t, u) => t + u.cacheReadInputTokens, 0);
      console.log(`[turn ${sess.turns}] ${tools} tool calls, ${((Date.now() - t0) / 1000).toFixed(1)} s, ${result.num_turns} model calls | session tokens in ${tin} (${cached} cached) / out ${tout} | turn ${money(cost)} | run ${money(spent)} | session ${money(sess.costUsd)}${result.subtype !== 'success' ? ' | ' + result.subtype : ''}`);
    }
    saveSess();
    const now = await play(base, 'status').catch(() => null);
    if (now && now.dead) ended = 'the hero is dead';
  }
  console.log(`[agent] stopped after ${sess.turns} turns this session${ended ? ' (' + ended + ')' : ''}; this run ${money(spent)}, session ${money(sess.costUsd)}. Session saved to ${SESSION_FILE}.`);
  if (PRICES[model]) console.log(`[agent] list price for ${model}: $${PRICES[model].in} in / $${PRICES[model].out} out per 1M tokens`);
}
