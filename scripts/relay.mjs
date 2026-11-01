// Brain relay (issue #40): the only place an API key lives. The browser sim POSTs a
// compact snapshot to http://127.0.0.1:8787/decide; the relay adds the system prompt for
// that decision kind, calls the model with a JSON schema (structured output) built from
// the options the sim offered, and returns {choice, crypt?, line?, reason?} or {error}.
// Every model call's reply also echoes what the model saw (issue #61, the Mind tab):
// sent:{id, system, user} is the exact system prompt and user content, size-capped.
//
//   POST /decide   {kind:'townPlan'|'cryptCall'|'fightOrFlee'|'say', snapshot:{...options:[...]}}  (cryptCall and say carry no options)
//                  {kind:'persona'|'backstory'|'memory', snapshot:{...companions:[{id,name,...}]}}  (Fellowship writing, #68:
//                  persona -> {voice,wants,fears,quirk,never_says,stances:{id:line}}; backstory -> {family,arms,defining,
//                  flaw,wants,joined,link,summary,link_id,link_hero,link_kind}; memory -> {long}; plus model)
//                  Any request may add provider:'anthropic'|'ollama'|'openai'|'google', model:'<id or tag>', effort
//                  (Mixed minds, #97; the hero's a.brainCfg). Default: anthropic with the models below.
//     200 {choice?, crypt?, line?, reason?, sent, usage:{in,out,cost}, provider, model}   (cryptCall: {crypt, reason})
//     4xx/5xx {error:'...', sent?, provider?, model?}   (the sim treats any error as "scripted")
//   GET  /health   {ok, model, requests, cost, byProvider:{name:{requests,errors,inTok,outTok,cost,ms}},
//                   providers:{anthropic:{ok,models}, ollama:{ok,url,models (pulled, from /api/tags),error?}, openai, google}, localTimeout}
//
// Providers: scripts/providers/ (anthropic.mjs = the Claude call, ollama.mjs = local models at OLLAMA_URL,
// default http://localhost:11434, cost 0; openai.mjs and google.mjs are stubs until built).
//
// Setup: put ANTHROPIC_API_KEY=... in .env at the repo root (gitignored; see .env.example),
// then `npm run relay`. Optional env: RELAY_MODEL, RELAY_PORT, RELAY_ORIGIN, OLLAMA_URL, OLLAMA_MODEL.
// With no key the relay still runs: Claude requests fail (scripted fallback), local models work.
// Verbose log: `npm run relay -- --verbose` (or RELAY_VERBOSE=1) appends one JSON line per
// call to logs/relay.jsonl: {ts, kind, hero, system, user, response, usage, ms}. Never the key or headers.
// Limits: 2.5 s per model call (hard abort; local models 8 s, see LOCAL_TIMEOUT), small max_tokens per kind, body <= 32 KB,
// CORS only for the dev origin. Token usage and a running cost estimate are logged.
import http from 'node:http';
import {readFileSync, existsSync, mkdirSync, appendFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import {FAC} from '../src/data/factions.js';
import {attachPlay, PLAY_LOG} from './relay-mcp.mjs'; // agent player: /mcp, /play (issue #75)
import {makeProviders, PROVIDERS, isLocal, MODEL_RE, DEFAULT_MODEL, PRICES, costOf} from './providers/index.mjs'; // Mixed minds (#97): one adapter per provider
import {KINDS, OPTION_KINDS, WRITE_KINDS, systemFor, schemaFor, MAX_TOKENS, promptId, cleanReason, cleanText, PERSONA_FIELDS, STANCE_MAX, BACKSTORY_FIELDS, LINK_KINDS, MEMORY_LONG_MAX} from '../src/data/prompts.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Cheapest current model (claude-api skill, cached 2026-10-06): Haiku 5.5, $0.10 in / $0.50 out per 1M tokens (prompts up to 100K).
// DEFAULT_MODEL, PRICES and costOf live with the Anthropic adapter (scripts/providers/anthropic.mjs).
export {DEFAULT_MODEL, PRICES, costOf};
// Local models (Ollama, #97) are slower than the API: decisions get 8 s, writing kinds at least 30 s.
// Env: RELAY_LOCAL_TIMEOUT, RELAY_LOCAL_WRITE_TIMEOUT (ms).
export const LOCAL_TIMEOUT = {decide: 8000, write: 30000};
export const TIMEOUT_MS = 2500, MAX_BODY = 32 * 1024, DEV_ORIGIN = 'http://localhost:5173';
// Fellowship writing kinds (issue #68): one-time character work on the Sonnet tier (the owner's plan;
// claude-api skill, cached 2026-10-06: claude-sonnet-5-5, $2 in / $10 out per 1M). The sim never waits
// for these, so they get a long timeout. memory (a summary of capped memories) stays on the default tier.
// Env override: RELAY_WRITE_MODEL for persona and backstory.
export const KIND_MODEL = {persona: 'claude-sonnet-5-5', backstory: 'claude-sonnet-5-5'};
export const KIND_TIMEOUT = {persona: 40000, backstory: 60000, memory: 15000};
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

// Check a snapshot well enough to build a prompt and schema from it.
export function checkRequest(body) {
  if (!body || typeof body !== 'object') return 'bad body';
  if (!KINDS.includes(body.kind)) return 'unknown kind';
  if (body.provider !== undefined && !PROVIDERS.includes(body.provider)) return 'unknown provider';
  if (body.model !== undefined && (typeof body.model !== 'string' || !MODEL_RE.test(body.model))) return 'bad model';
  if (body.effort !== undefined && !['low', 'medium', 'high'].includes(body.effort)) return 'bad effort';
  const s = body.snapshot; if (!s || typeof s !== 'object') return 'no snapshot';
  if (OPTION_KINDS.includes(body.kind)) {
    if (!Array.isArray(s.options) || s.options.length < 1 || s.options.length > 8 || s.options.some(o => typeof o !== 'string' || o.length > 40)) return 'bad options';
  }
  if (body.kind === 'persona' || body.kind === 'backstory') {
    const c = s.companions; if (c !== undefined && (!Array.isArray(c) || c.length > 6 || c.some(x => !x || typeof x.name !== 'string' || x.name.length > 40 || (typeof x.id !== 'number' && typeof x.id !== 'string')))) return 'bad companions';
  }
  return null;
}

// Validate what the model said against the options the sim sent; returns the reply or throws.
export function checkReply(kind, options, text, snap = {}) {
  let j; try {j = JSON.parse(text)} catch {throw new Error('model reply is not JSON')}
  if (WRITE_KINDS.includes(kind)) return checkWriting(kind, j, snap);
  if (OPTION_KINDS.includes(kind) && !options.includes(j.choice)) throw new Error('choice not in options');
  const reason = cleanReason(j.reason), r = reason ? {reason} : {};
  if (kind === 'cryptCall') {if (typeof j.crypt !== 'boolean') throw new Error('crypt is not a yes or no'); return {crypt: j.crypt, ...r}}
  if (kind === 'townPlan') return {choice: j.choice, crypt: j.crypt === true, ...r};
  const line = typeof j.line === 'string' ? j.line.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
  return kind === 'say' ? {line} : {choice: j.choice, line, ...r};
}
// Persona, backstory and memory replies: every field present and non-empty, cut to its cap; stances and
// the companion link only for companions the sim sent.
export function checkWriting(kind, j, snap = {}) {
  if (!j || typeof j !== 'object') throw new Error('reply is not an object');
  const comps = Array.isArray(snap.companions) ? snap.companions : [], out = {};
  const need = (fields) => {for (const k in fields) {const v = cleanText(j[k], fields[k]); if (!v) throw new Error('missing ' + k); out[k] = v}};
  if (kind === 'memory') {const v = cleanText(j.long, MEMORY_LONG_MAX); if (!v) throw new Error('missing long'); return {long: v}}
  if (kind === 'persona') {need(PERSONA_FIELDS); out.stances = {};
    for (const c of comps) {const v = cleanText(j.stances && j.stances[String(c.id)], STANCE_MAX); if (v) out.stances[String(c.id)] = v}
    return out}
  need(BACKSTORY_FIELDS);
  if (comps.length) {const c = comps.find(x => x.name === j.link_hero); if (!c) throw new Error('link_hero is not a companion');
    out.link_id = c.id; out.link_hero = c.name; out.link_kind = LINK_KINDS.includes(j.link_kind) ? j.link_kind : 'oath'}
  return out;
}
const cap = (t, n = ECHO_MAX) => t.length > n ? t.slice(0, n) + '…[cut]' : t;

// createRelay({client, model}) returns {server, stats}; client needs messages.create (the SDK, or a fake in tests).
// verbose: a file path; each call appends {ts, kind, hero, system, user, response, usage, ms}.
// providers: {name: adapter} (scripts/providers/); default built from client and the environment.
// localTimeout: {decide, write} ms for local providers (a writing kind gets at least its KIND_TIMEOUT).
export function createRelay({client, model = DEFAULT_MODEL, kindModel = KIND_MODEL, origin = DEV_ORIGIN, log = console.log, timeoutMs = TIMEOUT_MS, verbose = null, providers = null, localTimeout = LOCAL_TIMEOUT} = {}) {
  providers = providers || makeProviders({anthropicClient: client || null, model});
  const stats = {requests: 0, errors: 0, inTok: 0, outTok: 0, cost: 0, byProvider: {}};
  const vlog = rec => {
    if (!verbose) return;
    try {mkdirSync(dirname(verbose), {recursive: true}); appendFileSync(verbose, JSON.stringify(rec) + '\n')}
    catch (e) {log(`[relay] verbose log failed: ${e.message}`)}
  };

  // Returns the validated reply plus sent (what the model saw), usage, provider and model; throws an Error
  // carrying .sent (and .provider/.model) so a failed call can still show its prompt and who was asked.
  // The provider adapter (scripts/providers/) makes the call; validation is the same for every provider.
  async function decide(body) {
    const kind = body.kind, s = body.snapshot, ac = new AbortController(), t0 = Date.now();
    const prov = body.provider || 'anthropic', P = providers[prov], local = isLocal(prov);
    const mdl = body.model || (prov === 'anthropic' ? kindModel[kind] || model : P && P.defaultModel) || null;
    const tmo = local ? (WRITE_KINDS.includes(kind) ? Math.max(localTimeout.write, KIND_TIMEOUT[kind] || 0) : localTimeout.decide) : KIND_TIMEOUT[kind] || timeoutMs;
    const system = systemFor(kind, FAC.findIndex(f => f.name === s.fac)), user = JSON.stringify(s);
    const sent = {id: promptId(kind), system: cap(system), user: cap(user)};
    const who = {provider: prov, model: mdl}, ps = stats.byProvider[prov] || (stats.byProvider[prov] = {requests: 0, errors: 0, inTok: 0, outTok: 0, cost: 0, ms: 0});
    ps.requests++;
    const timer = setTimeout(() => ac.abort(), tmo);
    let usage = null, raw = null;
    const count = r => {
      if (!r || !r.usage) return; usage = r.usage; if (r.model) who.model = r.model;
      stats.inTok += usage.in; stats.outTok += usage.out; stats.cost += usage.cost;
      ps.inTok += usage.in; ps.outTok += usage.out; ps.cost += usage.cost;
      log(`[relay] ${kind} ${s.name || ''} ${prov}/${who.model} in=${usage.in} out=${usage.out} $${usage.cost.toFixed(6)} ${Date.now() - t0} ms total $${stats.cost.toFixed(4)} (${stats.requests} calls)`);
    };
    try {
      if (!P) throw new Error('unknown provider');
      const res = await P.call({system, user, schema: schemaFor(kind, s.options, s), maxTokens: MAX_TOKENS[kind], model: mdl, effort: body.effort || 'low', signal: ac.signal, timeoutMs: tmo});
      count(res); raw = res.text;
      const out = {...checkReply(kind, s.options, res.text, s), sent, usage, ...who};
      ps.ms += Date.now() - t0;
      vlog({ts: new Date().toISOString(), kind, hero: s.name || null, ...who, system, user, response: raw, usage, ms: Date.now() - t0});
      return out;
    } catch (e) {
      if (e && e.result) count(e.result);
      if (e && e.raw != null) raw = e.raw;
      ps.errors++;
      vlog({ts: new Date().toISOString(), kind, hero: s.name || null, ...who, system, user, response: raw, error: isAbort(e) ? 'timeout' : String(e.message || e), usage, ms: Date.now() - t0});
      e.sent = sent; e.who = who; throw e;
    } finally {clearTimeout(timer)}
  }
  // Which providers can answer: Anthropic configured or not, Ollama reachable or not and its pulled models.
  async function providerStatus() {
    const out = {};
    for (const name of PROVIDERS) {const P = providers[name]; if (!P) continue;
      try {out[name] = {...await P.status(), local: isLocal(name)}} catch (e) {out[name] = {ok: false, models: [], local: isLocal(name), error: String(e.message || e).slice(0, 80)}}}
    return out;
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
    if (req.method === 'GET' && req.url === '/health') return void providerStatus().then(p => send(200, {ok: true, model, ...stats, providers: p, localTimeout}), () => send(200, {ok: true, model, ...stats}));
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
        log(`[relay] ${body.kind} ${body.snapshot.name || ''} ${e.who ? e.who.provider + '/' + e.who.model : ''} failed: ${timeout ? 'timeout' : e.message}`);
        send(timeout ? 504 : 502, {error: timeout ? 'timeout' : String(e.message || e).slice(0, 200), ...(e.sent ? {sent: e.sent} : {}), ...(e.who || {})});
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
  if (!env.ANTHROPIC_API_KEY && !playOnly) console.warn('[relay] No ANTHROPIC_API_KEY: Claude requests will fail and those heroes play scripted. Local models (Ollama) still work. Put a key in .env (see .env.example) for Claude.');
  const model = env.RELAY_MODEL || DEFAULT_MODEL, port = Number(env.RELAY_PORT || 8787);
  const verbose = process.argv.includes('--verbose') || /^(1|true|yes)$/i.test(env.RELAY_VERBOSE || '') ? LOG_FILE : null;
  const client = env.ANTHROPIC_API_KEY ? new Anthropic({apiKey: env.ANTHROPIC_API_KEY}) : null;
  const providers = makeProviders({anthropicClient: client, model, env});
  const localTimeout = {decide: Number(env.RELAY_LOCAL_TIMEOUT) || LOCAL_TIMEOUT.decide, write: Number(env.RELAY_LOCAL_WRITE_TIMEOUT) || LOCAL_TIMEOUT.write};
  const kindModel = env.RELAY_WRITE_MODEL ? {persona: env.RELAY_WRITE_MODEL, backstory: env.RELAY_WRITE_MODEL} : KIND_MODEL;
  const {server} = createRelay({client, model, kindModel, origin: env.RELAY_ORIGIN || DEV_ORIGIN, verbose, providers, localTimeout});
  attachPlay(server, {origin: env.RELAY_ORIGIN || DEV_ORIGIN, verbose: verbose ? PLAY_LOG : null}); // agent player: MCP at /mcp, the game page at ws /play
  server.listen(port, '127.0.0.1', () => {
    console.log(`[relay] listening on http://127.0.0.1:${port}  model ${model}  origin ${env.RELAY_ORIGIN || DEV_ORIGIN}${verbose ? '  verbose -> ' + verbose : ''}`);
    providers.ollama.status().then(o => console.log(`[relay] ollama at ${o.url}: ${o.ok ? (o.models.length ? o.models.join(', ') : 'reachable, no models pulled') : o.error}`));
  });
}
