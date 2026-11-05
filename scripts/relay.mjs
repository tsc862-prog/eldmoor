// Brain relay (issue #40): the only place an API key lives. The browser sim POSTs a
// compact snapshot to http://127.0.0.1:8787/decide; the relay adds the system prompt for
// that decision kind, calls the model with a JSON schema (structured output) built from
// the options the sim offered, and returns {choice, crypt?, line?, reason?} or {error}.
// Every model call's reply also echoes what the model saw (issue #61, the Mind tab):
// sent:{id, system, user} is the exact system prompt and user content, size-capped.
//
//   POST /decide   {kind:'townPlan'|'cryptCall'|'fightOrFlee'|'say', snapshot:{...options:[...]}}  (cryptCall and say carry no options)
//                  {kind:'persona'|'backstory'|'memory'|'chapter', snapshot:{...companions:[{id,name,...}]}}  (Fellowship writing, #68:
//                  persona -> {voice,wants,fears,quirk,never_says,stances:{id:line}}; backstory -> {family,arms,defining,
//                  flaw,wants,joined,link,summary,link_id,link_hero,link_kind}; memory -> {long}; plus model)
//                  Any request may add provider:'anthropic'|'ollama'|'openai'|'huggingface'|'google', model:'<id or tag>', effort
//                  (Mixed minds, #97; the hero's a.brainCfg). Default: anthropic with the models below.
//     200 {choice?, crypt?, line?, reason?, sent, usage:{in,out,cost}, provider, model}   (cryptCall: {crypt, reason})
//     4xx/5xx {error:'...', sent?, provider?, model?}   (the sim treats any error as "scripted")
//   GET  /health   {ok, model, requests, cost, byProvider:{name:{requests,errors,inTok,outTok,cost,ms}},
//                   providers:{anthropic:{ok,models}, ollama:{ok,url,models (pulled, from /api/tags),numCtx (#221),error?}, openai, huggingface (Hugging Face router, #552), google (Gemini, #672)}, localTimeout}
//
// Providers: scripts/providers/ (anthropic.mjs = the Claude call, ollama.mjs = local models at OLLAMA_URL,
// default http://localhost:11434, cost 0; openai.mjs = OpenAI Chat Completions; google.mjs = Gemini through Google's OpenAI-compatible endpoint, #672).
//
// Setup: put ANTHROPIC_API_KEY=... in .env at the repo root (gitignored; see .env.example),
// then `npm run relay`. Optional env: RELAY_MODEL, RELAY_PORT, RELAY_ORIGIN, OLLAMA_URL, OLLAMA_MODEL.
// With no key the relay still runs: Claude requests fail (scripted fallback), local models work.
// App runners: `npm run relay -- --runners` (or RELAY_RUNNERS=1) lets the game page start and stop agent
// runners (scripts/runners.mjs: GET /play/runner, POST /play/runner/start|stop).
// Launcher (npm run up, scripts/up.mjs): --resume-runners restarts the last run's runners (logs/runners/active.json) once the page is back;
// --launcher (ELDMOOR_LAUNCHER=1) makes "stop" on stdin a clean quit, since Windows has no signal to send.
// Behavior logs (issue #129): logs/behavior/<world>/{turns,decisions,world,anomalies}.jsonl for the watcher (npm run
// behavior-report); --no-behavior or RELAY_BEHAVIOR=0 turns them off.
// Agent memories (issue #155): the game page's notebooks mirrored as Markdown under logs/agents/<world>/ (scripts/memory-mirror.mjs);
// --no-mirror or RELAY_MIRROR=0 turns it off. Written only, never read back into a prompt.
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
import {attachRunners} from './runners.mjs';
import {semanticRecall, embedConfig, embedStatus} from './embed.mjs'; // semantic memory search (issue #553)
import {ttsFromEnv, ttsOff} from './providers/tts.mjs'; // narrator voice: a local speech engine, loopback only (issue #554)
import {memoryMirror} from './memory-mirror.mjs'; // agent memories mirrored as Markdown (issue #155)
import {behaviorLog} from './behavior-log.mjs'; // behavior logs for the watcher (issue #129) // app runners: the page starts and stops agent runners (--runners)
import {makeProviders, PROVIDERS, isLocal, MODEL_RE, DEFAULT_MODEL, PRICES, costOf} from './providers/index.mjs';
import {makeLimiter, rateLimitOf} from './providers/limiter.mjs'; // per-provider concurrency (the org's concurrent-request cap) // Mixed minds (#97): one adapter per provider
import {KINDS, OPTION_KINDS, WRITE_KINDS, systemFor, schemaFor, MAX_TOKENS, promptId, cleanReason, cleanText, PERSONA_FIELDS, STANCE_MAX, BACKSTORY_FIELDS, LINK_KINDS, MEMORY_LONG_MAX, CHAPTER_TITLE_MAX, CHAPTER_TEXT_MAX} from '../src/data/prompts.js';

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
export const KIND_TIMEOUT = {persona: 40000, backstory: 60000, memory: 15000, chapter: 15000};
export const ECHO_MAX = 6000; // chars of system and of user content echoed back per reply
export const LOG_FILE = join(ROOT, 'logs', 'relay.jsonl');
// Concurrent Anthropic requests the relay allows at once (env RELAY_ANTHROPIC_CONCURRENCY). The owner's API org
// caps concurrent requests across all models; above it every extra call gets 429. Decisions queue ahead of
// writing kinds and are dropped when their deadline passes in the queue; a 429 pauses the queue (retry-after,
// else 1-2-4 s, at most RATE_PAUSE_MAX) and only writing kinds retry, with jitter, up to RATE_RETRIES times.
export const ANTHROPIC_CONCURRENCY = 2, RATE_RETRIES = 3, RATE_PAUSE_MAX = 10000;
export const DECIDE_MIN_LEFT = 300; // a decision that would leave the queue with less than this before its deadline is dropped (at most a quarter of its timeout)
export const OPENAI_CONCURRENCY = 4; // env RELAY_OPENAI_CONCURRENCY
export const HF_CONCURRENCY = 4; // env RELAY_HF_CONCURRENCY (#552), like OpenAI's
export const GOOGLE_CONCURRENCY = 4; // env RELAY_GOOGLE_CONCURRENCY (#672); RELAY_GOOGLE_RPM spaces starts to a per-minute quota (0 = off)
export const makeLimits = (env = {}) => ({anthropic: makeLimiter({max: Number(env.RELAY_ANTHROPIC_CONCURRENCY) || ANTHROPIC_CONCURRENCY}), openai: makeLimiter({max: Number(env.RELAY_OPENAI_CONCURRENCY) || OPENAI_CONCURRENCY}), huggingface: makeLimiter({max: Number(env.RELAY_HF_CONCURRENCY) || HF_CONCURRENCY}), google: makeLimiter({max: Number(env.RELAY_GOOGLE_CONCURRENCY) || GOOGLE_CONCURRENCY, rpm: Number(env.RELAY_GOOGLE_RPM) || 0})});
const sleepFor = (ms, signal) => new Promise((res, rej) => {if (signal && signal.aborted) return rej(Object.assign(new Error('aborted'), {name: 'AbortError'}));
  const t = setTimeout(res, ms); if (signal) signal.addEventListener('abort', () => {clearTimeout(t); rej(Object.assign(new Error('aborted'), {name: 'AbortError'}))}, {once: true})});
// One provider call through its limiter: queued (decisions first), paused on 429, writing kinds retried.
export async function limitedCall(lim, once, {urgent, retry, signal, deadline = null, minLeft = 0, log = () => {}, label = ''}) {
  for (let attempt = 0; ; attempt++) {
    try {return await lim.run(once, {urgent, signal, deadline, minLeft})}
    catch (e) {
      const rl = rateLimitOf(e); if (!rl) throw e;
      const back = rl.retryAfterMs != null ? rl.retryAfterMs : 1000 * 2 ** attempt;
      lim.rateLimited(Math.min(RATE_PAUSE_MAX, back));
      if (!retry || attempt >= RATE_RETRIES || (signal && signal.aborted)) {e.rateLimited = true; throw e}
      const wait = back * (1 + Math.random() * .5);
      log(`[relay] ${label} rate limited (429): retry ${attempt + 1}/${RATE_RETRIES} in ${(wait / 1000).toFixed(1)} s`);
      await sleepFor(wait, signal);
    }
  }
}

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
  if (kind === 'chapter') {need({title: CHAPTER_TITLE_MAX, text: CHAPTER_TEXT_MAX}); return out} // a journal chapter (#153)
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
// limits: {provider: makeLimiter()} (default: Anthropic at ANTHROPIC_CONCURRENCY); {} turns limiting off.
// onDecide({kind, hero, provider, model, ok, status, ms, cost?, tokensIn?, tokensOut?, choice?, error?}): every /decide call as answered, for the
// behavior logs (issue #129, scripts/behavior-log.mjs relayDecision); never the prompt, the reply text or a key.
export function createRelay({client, model = DEFAULT_MODEL, kindModel = KIND_MODEL, origin = DEV_ORIGIN, log = console.log, timeoutMs = TIMEOUT_MS, verbose = null, providers = null, localTimeout = LOCAL_TIMEOUT, limits = makeLimits(), onDecide = null, tts = null} = {}) {
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
      const once = () => P.call({system, user, schema: schemaFor(kind, s.options, s), maxTokens: MAX_TOKENS[kind], model: mdl, effort: body.effort || 'low', signal: ac.signal, timeoutMs: Math.max(1, tmo - (Date.now() - t0))});
      const lim = limits && limits[prov], writing = WRITE_KINDS.includes(kind);
      const res = lim ? await limitedCall(lim, once, {urgent: !writing, retry: writing, signal: ac.signal, deadline: t0 + tmo, minLeft: writing ? 0 : Math.min(DECIDE_MIN_LEFT, tmo / 4), log, label: `${kind} ${s.name || ''}`}) : await once();
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
    if (tts) {try {const t = await tts.status(); out.tts = {engine: t.engine, voices: t.voices, ready: t.ok, error: t.error}} catch {}} // issue #554
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
    const queues = () => Object.fromEntries(Object.entries(limits || {}).map(([k, l]) => [k, l.stats()])); // depth, in flight, 429s, dropped
    if (req.method === 'GET' && req.url === '/health') return void providerStatus().then(p => send(200, {ok: true, model, ...stats, providers: p, localTimeout, queues: queues()}), () => send(200, {ok: true, model, ...stats, queues: queues()}));
    if (tts && /^\/tts(\/|\?|$)/.test(req.url) && tts.route(req, res, send, origin_ === origin ? {'access-control-allow-origin': origin, vary: 'origin'} : {})) return; // narrator voice (#554)
    if (req.method !== 'POST' || req.url !== '/decide') return send(404, {error: 'not found'});
    let size = 0; const chunks = [];
    req.on('data', c => {size += c.length; if (size > MAX_BODY) {send(413, {error: 'too large'}); req.destroy()} else chunks.push(c)});
    req.on('end', async () => {
      if (size > MAX_BODY) return;
      let body; try {body = JSON.parse(Buffer.concat(chunks).toString('utf8'))} catch {return send(400, {error: 'bad json'})}
      const bad = checkRequest(body); if (bad) return send(400, {error: bad});
      stats.requests++;
      const t0 = Date.now(), seen = r => {if (onDecide) try {onDecide({kind: body.kind, hero: body.snapshot.name || null, ...r, ms: Date.now() - t0})} catch {}};
      try {const out = await decide(body); send(200, out); seen({provider: out.provider, model: out.model, ok: true, status: 200, ...(out.usage ? {cost: out.usage.cost, tokensIn: out.usage.in, tokensOut: out.usage.out} : {}), choice: out.choice ?? (out.crypt != null ? String(out.crypt) : null)})}
      catch (e) {
        stats.errors++;
        const timeout = isAbort(e);
        log(`[relay] ${body.kind} ${body.snapshot.name || ''} ${e.who ? e.who.provider + '/' + e.who.model : ''} failed: ${timeout ? (e.queued ? 'dropped in the queue (deadline passed)' : 'timeout') : e.message}`);
        const status = timeout ? 504 : e.rateLimited ? 429 : 502;
        seen({provider: e.who ? e.who.provider : body.provider || 'anthropic', model: e.who ? e.who.model : body.model || null, ok: false, status, error: timeout ? 'timeout' : e.rateLimited ? 'rate limited (429)' : String(e.message || e).slice(0, 160)});
        send(status, {error: timeout ? (e.queued ? 'timeout (queued: the provider was busy)' : 'timeout') : e.rateLimited ? 'rate limited by the provider' : String(e.message || e).slice(0, 200), ...(e.sent ? {sent: e.sent} : {}), ...(e.who || {})});
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
  const limits = makeLimits(env);
  // Behavior logs (issue #129): logs/behavior/<world>/ (the world the game page names); off with --no-behavior or RELAY_BEHAVIOR=0.
  const behavior = process.argv.includes('--no-behavior') || /^(0|false|no|off)$/i.test(env.RELAY_BEHAVIOR || '') ? null : behaviorLog({world: env.ELDMOOR_WORLD || 'eldmoor', log: console.log});
  const tts = ttsOff(env) ? null : ttsFromEnv(env); // RELAY_TTS=0 turns the narrator voice off
  const {server} = createRelay({client, model, kindModel, origin: env.RELAY_ORIGIN || DEV_ORIGIN, verbose, providers, localTimeout, limits, onDecide: behavior ? behavior.relayDecision : null, tts});
  // Agent memories (issue #155): logs/agents/<world>/<hero>/memory/*.md from the page's notebooks; off with --no-mirror or RELAY_MIRROR=0.
  const mirror = process.argv.includes('--no-mirror') || /^(0|false|no|off)$/i.test(env.RELAY_MIRROR || '') ? null : memoryMirror({world: env.ELDMOOR_WORLD || 'eldmoor', log: console.log});
  // Semantic memory search (issue #553): recall and journal_search ranked by meaning with a local embedding model (OLLAMA_EMBED_MODEL, default nomic-embed-text); RELAY_EMBED=0 turns it off; keywords rank when the model is not pulled.
  const embedCfg = embedConfig(env), embed = embedCfg.enabled ? semanticRecall({adapter: providers.ollama, world: env.ELDMOOR_WORLD || 'eldmoor', config: embedCfg, log: console.log}) : null;
  const play = attachPlay(server, {origin: env.RELAY_ORIGIN || DEV_ORIGIN, verbose: verbose ? PLAY_LOG : null, behavior, mirror, embed}); // agent player: MCP at /mcp, the game page at ws /play
  // App runners: with --runners (or RELAY_RUNNERS=1) the game page may start and stop agent runners
  // (child processes of this relay; scripts/runners.mjs). Off by default.
  const runnersOn = process.argv.includes('--runners') || /^(1|true|yes)$/i.test(env.RELAY_RUNNERS || '');
  const sup = attachRunners(server, {play, enabled: runnersOn, origin: env.RELAY_ORIGIN || DEV_ORIGIN, base: () => `http://127.0.0.1:${port}`});
  // Quit: every runner gets "stop" on its stdin and a moment to let go of its heroes (they stay on the active list,
  // logs/runners/active.json, so --resume-runners brings them back); exit kills the rest.
  let quitting = false;
  const quit = () => {if (quitting) return; quitting = true; sup.shutdown().then(() => setTimeout(() => process.exit(0), 200)); setTimeout(() => process.exit(0), 10000).unref()};
  process.on('SIGINT', quit); process.on('SIGTERM', quit); process.on('SIGHUP', quit);
  // The one-window launcher (npm run up, scripts/up.mjs) cannot send a signal that Windows delivers to a node process,
  // so it writes "stop" on this process's stdin (and closes it when it goes away): the same clean quit.
  if (/^(1|true|yes)$/i.test(env.ELDMOOR_LAUNCHER || '') || process.argv.includes('--launcher')) {
    process.stdin.setEncoding('utf8'); process.stdin.on('data', d => {if (/\bstop\b/.test(d)) quit()}); process.stdin.on('end', quit); process.stdin.on('error', quit); process.stdin.resume();
  }
  server.listen(port, '127.0.0.1', () => {
    console.log(`[relay] listening on http://127.0.0.1:${port}  model ${model}  origin ${env.RELAY_ORIGIN || DEV_ORIGIN}${verbose ? '  verbose -> ' + verbose : ''}${behavior ? '  behavior logs -> ' + behavior.dir() : ''}`);
    console.log(runnersOn ? '[relay] app runners ON: the game page can start and stop agent runners (logs in logs/runners/)' : '[relay] app runners off (start with --runners to launch agent runners from the game page)');
    if (runnersOn && (process.argv.includes('--resume-runners') || /^(1|true|yes)$/i.test(env.RELAY_RESUME_RUNNERS || ''))) sup.resume().catch(e => console.log('[runners] resume failed: ' + e.message)); // the last run's runners, once the page is back
    if (tts) tts.status().then(o => console.log(o.ok ? `[relay] narrator voice: ${o.engine} at ${o.url}, ${o.voices.length} voices, clips cached in logs/tts/` : '[relay] ' + o.hint)); else console.log('[relay] narrator voice off (RELAY_TTS=0)');
    embedStatus(providers.ollama, embedCfg).then(o => console.log('[relay] ' + o.line));
    providers.ollama.status().then(o => console.log(`[relay] ollama at ${o.url}: ${o.ok ? (o.models.length ? o.models.join(', ') : 'reachable, no models pulled') : o.error} | num_ctx ${o.numCtx} for every local call (OLLAMA_NUM_CTX)`));
    if (providers.google && providers.google.configured()) providers.google.status().then(o => console.log(`[relay] google (Gemini, ${providers.google.tier || 'free'} tier): ${o.ok ? (o.models.length ? o.models.length + ' chat models' + (o.default ? ', default ' + o.default : '') : 'no chat model listed') : o.error}${(Number(env.RELAY_GOOGLE_RPM) || 0) ? ' | at most ' + Number(env.RELAY_GOOGLE_RPM) + ' calls a minute (RELAY_GOOGLE_RPM)' : ''}`));
    if (providers.openai && providers.openai.configured()) providers.openai.status().then(o => { if (o.ok) console.log(`[relay] openai: ${o.models.length} model${o.models.length === 1 ? '' : 's'}, cheapest first (OPENAI_MODELS narrows the list)${o.dropped ? ' | in OPENAI_MODELS but not usable with this key, dropped: ' + o.dropped.join(', ') : ''}`) });
    if (providers.huggingface && providers.huggingface.configured()) providers.huggingface.status().then(o => console.log(`[relay] huggingface: ${o.ok ? (o.models.length ? o.models.join(', ') : 'no model answered') + (o.dropped ? ' (not supported, dropped: ' + o.dropped.join(', ') + ')' : '') : o.error} | one tiny call per model, checked once (HF_MODELS); shares the free allowance with the art pipeline`));
  });
}
