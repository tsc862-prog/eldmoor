// Brain relay (issue #40): the only place an API key lives. The browser sim POSTs a
// compact snapshot to http://127.0.0.1:8787/decide; the relay adds the system prompt for
// that decision kind, calls the model with a JSON schema (structured output) built from
// the options the sim offered, and returns {choice, crypt?, line?, reason?} or {error}.
// Every model call's reply also echoes what the model saw (issue #61, the Mind tab):
// sent:{id, system, user} is the exact system prompt and user content, size-capped.
//
//   POST /decide   {kind:'townPlan'|'cryptCall'|'fightOrFlee'|'say', snapshot:{...options:[...]}}  (cryptCall and say carry no options)
//     200 {choice?, crypt?, line?, reason?, sent, usage:{in,out,cost}}   (cryptCall: {crypt, reason})
//     4xx/5xx {error:'...', sent?}   (the sim treats any error as "scripted")
//   GET  /health   {ok, model, requests, cost}
//
// Setup: put ANTHROPIC_API_KEY=... in .env at the repo root (gitignored; see .env.example),
// then `npm run relay`. Optional env: RELAY_MODEL, RELAY_PORT, RELAY_ORIGIN.
// Verbose log: `npm run relay -- --verbose` (or RELAY_VERBOSE=1) appends one JSON line per
// call to logs/relay.jsonl: {ts, kind, hero, system, user, response, usage, ms}. Never the key or headers.
// Limits: 2.5 s per model call (hard abort), small max_tokens per kind, body <= 32 KB,
// CORS only for the dev origin. Token usage and a running cost estimate are logged.
import http from 'node:http';
import {readFileSync, existsSync, mkdirSync, appendFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import {FAC} from '../src/data/factions.js';
import {attachPlay, PLAY_LOG} from './relay-mcp.mjs'; // agent player: /mcp, /play (issue #75)
import {KINDS, OPTION_KINDS, systemFor, schemaFor, MAX_TOKENS, promptId, cleanReason} from '../src/data/prompts.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Cheapest current model (claude-api skill, cached 2026-10-06): Haiku 5.5, $0.10 in / $0.50 out per 1M tokens (prompts up to 100K).
export const DEFAULT_MODEL = 'claude-haiku-5-5';
export const PRICES = {'claude-haiku-5-5': {in: 0.10, out: 0.50}, 'claude-sonnet-5-5': {in: 2, out: 10}, 'claude-opus-5-5': {in: 4, out: 20}}; // $ per 1M tokens
export const TIMEOUT_MS = 2500, MAX_BODY = 32 * 1024, DEV_ORIGIN = 'http://localhost:5173';
export const ECHO_MAX = 6000; // chars of system and of user content echoed back per reply
export const LOG_FILE = join(ROOT, 'logs', 'relay.jsonl');

// Minimal .env reader (no dependency). Real environment variables win; .env.local beats .env.
export function loadEnv(root = ROOT, env = process.env) {
  for (const f of ['.env.local', '.env']) {
    const p = join(root, f); if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (!m || line.trim().startsWith('#')) continue;
      if (env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return env;
}

export const costOf = (model, inTok, outTok) => {const p = PRICES[model]; return p ? (inTok * p.in + outTok * p.out) / 1e6 : 0};

// Check a snapshot well enough to build a prompt and schema from it.
export function checkRequest(body) {
  if (!body || typeof body !== 'object') return 'bad body';
  if (!KINDS.includes(body.kind)) return 'unknown kind';
  const s = body.snapshot; if (!s || typeof s !== 'object') return 'no snapshot';
  if (OPTION_KINDS.includes(body.kind)) {
    if (!Array.isArray(s.options) || s.options.length < 1 || s.options.length > 8 || s.options.some(o => typeof o !== 'string' || o.length > 40)) return 'bad options';
  }
  return null;
}

// Validate what the model said against the options the sim sent; returns the reply or throws.
export function checkReply(kind, options, text) {
  let j; try {j = JSON.parse(text)} catch {throw new Error('model reply is not JSON')}
  if (OPTION_KINDS.includes(kind) && !options.includes(j.choice)) throw new Error('choice not in options');
  const reason = cleanReason(j.reason), r = reason ? {reason} : {};
  if (kind === 'cryptCall') {if (typeof j.crypt !== 'boolean') throw new Error('crypt is not a yes or no'); return {crypt: j.crypt, ...r}}
  if (kind === 'townPlan') return {choice: j.choice, crypt: j.crypt === true, ...r};
  const line = typeof j.line === 'string' ? j.line.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
  return kind === 'say' ? {line} : {choice: j.choice, line, ...r};
}
const cap = (t, n = ECHO_MAX) => t.length > n ? t.slice(0, n) + '…[cut]' : t;

// createRelay({client, model}) returns {server, stats}; client needs messages.create (the SDK, or a fake in tests).
// verbose: a file path; each call appends {ts, kind, hero, system, user, response, usage, ms}.
export function createRelay({client, model = DEFAULT_MODEL, origin = DEV_ORIGIN, log = console.log, timeoutMs = TIMEOUT_MS, verbose = null} = {}) {
  const stats = {requests: 0, errors: 0, inTok: 0, outTok: 0, cost: 0};
  const vlog = rec => {
    if (!verbose) return;
    try {mkdirSync(dirname(verbose), {recursive: true}); appendFileSync(verbose, JSON.stringify(rec) + '\n')}
    catch (e) {log(`[relay] verbose log failed: ${e.message}`)}
  };

  // Returns the validated reply plus sent (what the model saw) and usage; throws an Error
  // carrying .sent so a failed call can still show its prompt.
  async function decide(body) {
    const kind = body.kind, s = body.snapshot, ac = new AbortController(), t0 = Date.now();
    const system = systemFor(kind, FAC.findIndex(f => f.name === s.fac)), user = JSON.stringify(s);
    const sent = {id: promptId(kind), system: cap(system), user: cap(user)};
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    let usage = null, raw = null;
    try {
      const res = await client.messages.create({
        model, max_tokens: MAX_TOKENS[kind],
        system,
        thinking: {type: 'disabled'},
        output_config: {effort: 'low', format: {type: 'json_schema', schema: schemaFor(kind, s.options)}},
        messages: [{role: 'user', content: user}],
      }, {signal: ac.signal, timeout: timeoutMs, maxRetries: 0});
      const u = res.usage || {}, cost = costOf(model, u.input_tokens || 0, u.output_tokens || 0);
      usage = {in: u.input_tokens || 0, out: u.output_tokens || 0, cost};
      stats.inTok += usage.in; stats.outTok += usage.out; stats.cost += cost;
      log(`[relay] ${kind} ${s.name || ''} in=${u.input_tokens} out=${u.output_tokens} $${cost.toFixed(6)} total $${stats.cost.toFixed(4)} (${stats.requests} calls)`);
      const block = (res.content || []).find(b => b.type === 'text');
      raw = block ? block.text : null;
      if (res.stop_reason === 'refusal') throw new Error('model refused');
      if (res.stop_reason === 'max_tokens') throw new Error('reply cut off');
      if (!block) throw new Error('no text in reply');
      const out = {...checkReply(kind, s.options, block.text), sent, usage};
      vlog({ts: new Date().toISOString(), kind, hero: s.name || null, system, user, response: raw, usage, ms: Date.now() - t0});
      return out;
    } catch (e) {
      vlog({ts: new Date().toISOString(), kind, hero: s.name || null, system, user, response: raw, error: isAbort(e) ? 'timeout' : String(e.message || e), usage, ms: Date.now() - t0});
      e.sent = sent; throw e;
    } finally {clearTimeout(timer)}
  }

  const server = http.createServer((req, res) => {
    const origin_ = req.headers.origin;
    const send = (code, obj) => {
      const h = {'content-type': 'application/json'};
      if (origin_ === origin) {h['access-control-allow-origin'] = origin; h['vary'] = 'origin'}
      res.writeHead(code, h); res.end(JSON.stringify(obj));
    };
    if (origin_ && origin_ !== origin) return send(403, {error: 'origin not allowed'});
    if (req.method === 'OPTIONS') {
      const h = origin_ === origin ? {'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, GET, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '600', vary: 'origin'} : {};
      res.writeHead(204, h); return res.end();
    }
    if (req.method === 'GET' && req.url === '/health') return send(200, {ok: true, model, ...stats});
    if (req.method !== 'POST' || req.url !== '/decide') return send(404, {error: 'not found'});
    let size = 0; const chunks = [];
    req.on('data', c => {size += c.length; if (size > MAX_BODY) {send(413, {error: 'too large'}); req.destroy()} else chunks.push(c)});
    req.on('end', async () => {
      if (size > MAX_BODY) return;
      let body; try {body = JSON.parse(Buffer.concat(chunks).toString('utf8'))} catch {return send(400, {error: 'bad json'})}
      const bad = checkRequest(body); if (bad) return send(400, {error: bad});
      stats.requests++;
      try {send(200, await decide(body))}
      catch (e) {
        stats.errors++;
        const timeout = isAbort(e);
        log(`[relay] ${body.kind} failed: ${timeout ? 'timeout' : e.message}`);
        send(timeout ? 504 : 502, {error: timeout ? 'timeout' : String(e.message || e).slice(0, 200), ...(e.sent ? {sent: e.sent} : {})});
      }
    });
  });
  return {server, stats};
}
const isAbort = e => e && (e.name === 'AbortError' || /abort|timed out/i.test(e.message || '') || e.constructor?.name === 'APIConnectionTimeoutError' || e.constructor?.name === 'APIUserAbortError');

// ---- run as a script ----
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const env = loadEnv();
  const playOnly = process.argv.includes('--play-only'); // agent player bridge without brain calls (no key needed)
  if (!env.ANTHROPIC_API_KEY && !playOnly) {console.error('No ANTHROPIC_API_KEY. Copy .env.example to .env and put your key in it (or run with --play-only for the agent bridge alone).'); process.exit(1)}
  const model = env.RELAY_MODEL || DEFAULT_MODEL, port = Number(env.RELAY_PORT || 8787);
  const verbose = process.argv.includes('--verbose') || /^(1|true|yes)$/i.test(env.RELAY_VERBOSE || '') ? LOG_FILE : null;
  const client = env.ANTHROPIC_API_KEY ? new Anthropic({apiKey: env.ANTHROPIC_API_KEY}) : {messages: {create: async () => {throw new Error('relay started with --play-only')}}};
  const {server} = createRelay({client, model, origin: env.RELAY_ORIGIN || DEV_ORIGIN, verbose});
  attachPlay(server, {origin: env.RELAY_ORIGIN || DEV_ORIGIN, verbose: verbose ? PLAY_LOG : null}); // agent player: MCP at /mcp, the game page at ws /play
  server.listen(port, '127.0.0.1', () => console.log(`[relay] listening on http://127.0.0.1:${port}  model ${model}  origin ${env.RELAY_ORIGIN || DEV_ORIGIN}${verbose ? '  verbose -> ' + verbose : ''}`));
}
