// Gemini provider check (issue #672). No network and no key: a mock server on a free port stands in for
// generativelanguage.googleapis.com (the OpenAI-compatible surface under /v1beta/openai and the native
// /v1beta/models/<m>:generateContent); nothing here reads GOOGLE_API_KEY from the real environment or .env.
// Checks: the adapter (model list from GET /models filtered and stripped, the request fields, reasoning_effort per
// model and the thinking headroom, free tier cost 0 and paid tier from the price table, thinking tokens counted as
// output), the native fallback (a schema the compat layer rejects, GOOGLE_NATIVE=1, MAX_TOKENS / SAFETY / a blocked
// prompt), errors (a bad key, the daily free quota never retried, a per-minute 429 with its retry delay, the key in
// no message), thought signatures sent back within a turn and the flattened retry, the limiter (quota not retried,
// rpm spacing), the relay (/decide, /health, its queue), the runner checks and tables, a real
// `agent-player.mjs --provider google` run and a real `dm-agent.mjs --provider google` run on headless worlds.
// Usage: npm run googlecheck
import {mkTmp} from './tmp.mjs';
import {dmMindCases} from './dm-mind-cases.mjs';
import {schemaFill, toolsProblem, isDmTurn, dmTurnMessage} from './mock-dm.mjs';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync, readFileSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {googleAdapter, googleFromEnv, GOOGLE_URL, PRICES, PRICES_SOURCE, FREE_MODELS, costOf, isGeminiChat, effortFor, HEADROOM, flattenCalls} from './providers/google.mjs';
import {toOpenAI} from './providers/openai.mjs';
import {makeLimiter, rateLimitOf} from './providers/limiter.mjs';
import {makeProviders, PROVIDERS, isLocal} from './providers/index.mjs';
import {createRelay, makeLimits} from './relay.mjs';
import {localTurn, ollamaTools} from './local-agent.mjs';
import {openaiRunner, isCompat, compatLabel} from './agent-chat.mjs';
import {RUNNER_PROVIDERS} from './agent-sessions.mjs';
import {checkStart} from './runners.mjs';
import {DM_PROVIDERS} from './dm-agent.mjs';
import {MIND_PROVIDERS, PROVIDER_LABEL, modelTag} from '../src/sim/brain.js';
import {SETUP_PROVIDERS} from '../src/sim/setup.js';
import {priceLabel} from '../src/ui/pricelabel.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const KEY = 'AIzaTestKey_0123456789abcdef';
const G38 = 'gemini-3.8-flash', G25 = 'gemini-2.5-flash', NOSCHEMA = 'gemini-3.6-flash', SIG = 'gemini-3.5-flash-lite', DMPLAN = G25; // DMPLAN: the mock plays the two-call DM turn on this model
const LISTED = ['models/' + G38, 'models/' + G25, 'models/' + NOSCHEMA, 'models/' + SIG, 'models/gemini-embedding-001', 'models/gemini-3.1-flash-live-preview', 'models/gemini-2.5-flash-image', 'models/imagen-4'];
const compat = [], native = [], st = {mode: 'ok'};
// A value for a JSON schema (enum: the first; strings: a short English line).
const fill = s => {if (!s || typeof s !== 'object') return null; if (Array.isArray(s.enum)) return s.enum[0];
  const t = Array.isArray(s.type) ? s.type.find(x => x !== 'null') : s.type;
  if (t === 'object') {const o = {}; for (const [k, v] of Object.entries(s.properties || {})) if (!s.required || s.required.includes(k)) o[k] = fill(v); return o}
  if (t === 'array') return s.minItems ? [fill(s.items)] : []; if (t === 'boolean') return false; if (t === 'number' || t === 'integer') return s.minimum ?? 1;
  return 'The fen keeps its counsel.'};
const DAILY = {error: {code: 429, status: 'RESOURCE_EXHAUSTED', message: 'You exceeded your current quota, please check your plan and billing details. Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 250, model: gemini-3.8-flash',
  details: [{'@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier'}]}]}};
const MINUTE = {error: {code: 429, status: 'RESOURCE_EXHAUSTED', message: 'You exceeded your current quota. Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 10. Please retry in 1.5s.',
  details: [{'@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier'}]}, {'@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '1s'}]}};
const BADKEY = [{error: {code: 400, status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.', details: [{reason: 'API_KEY_INVALID'}]}}];
const server = http.createServer((req, res) => {
  const send = (code, o, h = {}) => {res.writeHead(code, {'content-type': 'application/json', ...h}); res.end(JSON.stringify(o))};
  if (/[?&]key=/.test(req.url)) return send(400, {error: {message: 'the key must not ride in the URL'}});
  const isNative = /^\/v1beta\/models\/[^/]+:generateContent$/.test(req.url);
  const keyOk = isNative ? req.headers['x-goog-api-key'] === KEY : req.headers.authorization === 'Bearer ' + KEY;
  if (!keyOk) return send(400, BADKEY);
  if (req.method === 'GET' && req.url === '/v1beta/openai/models') return send(200, {object: 'list', data: LISTED.map(id => ({id, object: 'model', owned_by: 'google'}))});
  let b = ''; req.on('data', c => b += c); req.on('end', () => {
    const body = JSON.parse(b || '{}');
    if (st.mode === 'daily') return send(429, DAILY);
    if (st.mode === 'minute') return send(429, MINUTE);
    if (isNative) {
      native.push({url: req.url, body});
      const um = {promptTokenCount: 700, candidatesTokenCount: 25, thoughtsTokenCount: 75, totalTokenCount: 800};
      if (st.mode === 'blocked') return send(200, {promptFeedback: {blockReason: 'SAFETY'}, usageMetadata: um});
      const text = JSON.stringify(fill(body.generationConfig && body.generationConfig.responseJsonSchema));
      const fr = st.mode === 'cut' ? 'MAX_TOKENS' : st.mode === 'safety' ? 'SAFETY' : 'STOP';
      return send(200, {candidates: [{content: {role: 'model', parts: [{text: 'thinking...', thought: true}, {text}]}, finishReason: fr}], usageMetadata: um, modelVersion: decodeURIComponent(req.url.split('/models/')[1].split(':')[0])});
    }
    if (req.method !== 'POST' || req.url !== '/v1beta/openai/chat/completions') return send(404, {error: {message: 'not found'}});
    compat.push(body);
    const tp = toolsProblem(body); if (tp) return send(400, [{error: {code: 400, status: 'INVALID_ARGUMENT', message: tp}}]);
    const rf = body.response_format, usage = {prompt_tokens: 900, completion_tokens: 20, total_tokens: 1020}; // 100 thinking tokens not in completion_tokens
    const reply = (message, finish = 'stop') => send(200, {id: 'x', object: 'chat.completion', model: body.model, usage, choices: [{index: 0, finish_reason: finish, message}]});
    if (body.model === NOSCHEMA && rf && rf.type === 'json_schema') return send(400, [{error: {code: 400, status: 'INVALID_ARGUMENT', message: 'Invalid JSON payload received. Unknown name "strict" at \'response_format.json_schema\': Cannot find field.'}}]);
    if (rf && rf.type === 'json_schema') return reply({role: 'assistant', content: JSON.stringify(rf.json_schema.schema.properties && rf.json_schema.schema.properties.text ? schemaFill(rf.json_schema.schema) : fill(rf.json_schema.schema))});
    if (isDmTurn(body) && body.model === DMPLAN) {const m = dmTurnMessage(body); return reply(m, m.tool_calls ? 'tool_calls' : 'stop')}
    const msgs = body.messages, last = msgs.map((m, i) => m.role === 'user' ? i : -1).filter(i => i >= 0).pop(), turn = msgs.slice(last + 1);
    if (body.model === SIG && turn.some(m => m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.some(c => !(c.extra_content && c.extra_content.google && c.extra_content.google.thought_signature === 'sig-abc'))))
      return send(400, [{error: {code: 400, status: 'INVALID_ARGUMENT', message: 'Function call is missing a thought_signature in functionCall parts.'}}]);
    const names = (body.tools || []).map(t => t.function && t.function.name);
    if (body.tools && !turn.some(m => m.role === 'tool')) {
      const name = names.includes('dm_status') ? 'dm_status' : 'status';
      return reply({role: 'assistant', content: null, tool_calls: [{id: 'c1', type: 'function', function: {name, arguments: '{}'}, ...(body.model === SIG ? {extra_content: {google: {thought_signature: 'sig-abc'}}} : {})}]}, 'tool_calls');
    }
    reply({role: 'assistant', content: names.includes('dm_status') ? 'The DM read the table and let the road stay quiet.' : 'The hero looked about.'});
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/v1beta/openai`;
const err = async p => {try {await p; return null} catch (e) {return e}};
const schema = {type: 'object', additionalProperties: false, required: ['line'], properties: {line: {type: 'string'}}};
const town = {kind: 'townPlan', snapshot: {fac: 'Warband', name: 'Test', options: ['Thornvale', 'Mirefen']}};
const mk = (o = {}) => googleAdapter({apiKey: KEY, baseUrl: url, ...o});
const lastC = () => compat[compat.length - 1], lastN = () => native[native.length - 1];

console.log('google adapter (mock Gemini, compat path)');
{
  ok(GOOGLE_URL === 'https://generativelanguage.googleapis.com/v1beta/openai' && /ai\.google\.dev\/gemini-api\/docs\/pricing \(read 2026-11-03\)/.test(PRICES_SOURCE) && PRICES[G38] && FREE_MODELS.includes(G38) && !FREE_MODELS.includes('gemini-4-argon'), 'compat base URL, price table with its source and date, the free-tier models');
  ok(isGeminiChat(G38) && !isGeminiChat('gemini-embedding-001') && !isGeminiChat('gemini-3.1-flash-live-preview') && !isGeminiChat('imagen-4') && effortFor(G25) === 'none' && effortFor(G38) === 'low', 'chat-model filter; thinking off on 2.5 Flash, "low" elsewhere');
  const ad = mk();
  ok(ad.name === 'google' && ad.label === 'Gemini' && !ad.local && ad.free && ad.tier === 'free' && ad.configured() && ad.defaultModel === null, 'named google, label Gemini, remote, free tier by default, no default model in code');
  const s = await ad.status();
  ok(s.ok && JSON.stringify(s.models) === JSON.stringify([G25, NOSCHEMA, SIG, G38].sort()) && s.free === true && /free tier/.test(s.note) && /GOOGLE_MODEL/.test(s.note), 'status: GET /models filtered to chat models, "models/" stripped, free tier and the pick-a-model note');
  ok(JSON.stringify(s.models) === JSON.stringify([G25, SIG, NOSCHEMA, G38]) && s.prices && s.prices[G38].in === 0 && s.prices[G38].out === 0 && priceLabel(s, G38) === ' · $0.00 / $0.00 per 1M', 'picker list cheapest first by the paid price (#677); free tier labels read $0 / $0');
  const ps = await mk({tier: 'paid'}).status();
  ok(ps.prices[G38].in === PRICES[G38].in && ps.prices[G38].out === PRICES[G38].out && priceLabel(ps, G38) === ' · $0.75 / $3.75 per 1M', 'paid tier labels carry the price table');
  const al = await mk({allow: [G38, 'gemini-9-nope']}).status();
  ok(JSON.stringify(al.models) === JSON.stringify([G38]) && al.dropped.join() === 'gemini-9-nope', 'an allow list keeps exactly the listed models the key can use and reports the rest as dropped');
  const r = await ad.call({system: 'You are a hero.', user: '{"x":1}', schema, maxTokens: 60, model: G38}), q = lastC();
  ok(r.text === '{"line":"The fen keeps its counsel."}' && r.usage.in === 900 && r.usage.out === 120 && r.usage.cost === 0 && r.usage.costKnown === true, 'a decision: thinking tokens counted as output (total - prompt), cost $0 on the free tier');
  ok(q.model === G38 && q.max_tokens === 60 + HEADROOM && q.reasoning_effort === 'low' && q.response_format.type === 'json_schema' && q.response_format.json_schema.strict === true, 'request: strict json_schema, max_tokens + thinking headroom, reasoning_effort low');
  ok(Object.keys(q).every(k => ['model', 'reasoning_effort', 'max_tokens', 'response_format', 'messages'].includes(k)), 'request carries no other field (' + Object.keys(q).join(',') + ')');
  await ad.call({system: 's', user: 'u', schema, maxTokens: 60, model: G25}); ok(lastC().reasoning_effort === 'none' && lastC().max_tokens === 60, '2.5 Flash: thinking off, no headroom');
  const paid = mk({tier: 'paid'}), p = await paid.call({system: 's', user: 'u', schema, maxTokens: 60, model: G38});
  ok(Math.abs(p.usage.cost - costOf(G38, 900, 120)) < 1e-12 && p.usage.cost > 0 && paid.tier === 'paid' && !paid.free, 'GOOGLE_TIER=paid: cost from the price table, thinking tokens at the output rate');
  ok(googleFromEnv({GOOGLE_TIER: 'paid', GOOGLE_API_KEY: KEY}).tier === 'paid' && googleFromEnv({GOOGLE_API_KEY: KEY}).tier === 'free', 'GOOGLE_TIER reads paid, else free');
  let e = await err(ad.call({system: 's', user: 'u', schema, maxTokens: 60}));
  ok(e && /google: no model chosen/.test(e.message), 'no model -> asks to pick one');
  const bad = mk({apiKey: 'AIzaWrongKey_99999999'});
  e = await err(bad.call({system: 's', user: 'u', schema, maxTokens: 60, model: G38})); const bs = await bad.status();
  ok(e && e.kind === 'auth' && e.message === 'google: bad or missing GOOGLE_API_KEY' && !bs.ok && /bad or missing GOOGLE_API_KEY/.test(bs.error) && !JSON.stringify([e.message, bs]).includes('AIzaWrongKey'), 'a bad key (Google answers 400 "API key not valid") -> "bad or missing GOOGLE_API_KEY", the key in no message');
  const none = mk({apiKey: null}), ns = await none.status();
  ok(!ns.ok && /no GOOGLE_API_KEY/.test(ns.error) && !none.configured(), 'no key -> not configured, says GOOGLE_API_KEY');
  st.mode = 'daily'; e = await err(ad.call({system: 's', user: 'u', schema, maxTokens: 60, model: G38}));
  ok(e && e.kind === 'quota' && e.message === 'Gemini free quota used up for today; the hero plays scripted / the runner waits' && rateLimitOf(e) === null, 'the daily free quota -> "Gemini free quota used up for today ...", kind quota, never retried by the limiter');
  st.mode = 'minute'; e = await err(ad.call({system: 's', user: 'u', schema, maxTokens: 60, model: G38}));
  ok(e && e.kind === 'rate' && e.retryAfter === 2 && e.headers['retry-after'] === '2' && rateLimitOf(e) && rateLimitOf(e).retryAfterMs === 2000, 'a per-minute 429 -> rate limit with the retry delay Google names (the relay limiter pauses for it)'); st.mode = 'ok';
}

console.log('native generateContent fallback');
{
  const ad = mk(), n0 = native.length, c0 = compat.length;
  const r = await ad.call({system: 'You are a hero.', user: 'u', schema, maxTokens: 60, model: NOSCHEMA}), q = lastN();
  ok(compat.length === c0 + 1 && native.length === n0 + 1 && r.text === '{"line":"The fen keeps its counsel."}', 'the compat layer rejects the strict schema -> the same call goes to generateContent');
  ok(q.url === '/v1beta/models/' + NOSCHEMA + ':generateContent' && q.body.systemInstruction.parts[0].text === 'You are a hero.' && q.body.contents[0].role === 'user' && q.body.generationConfig.responseMimeType === 'application/json' && JSON.stringify(q.body.generationConfig.responseJsonSchema) === JSON.stringify(schema) && q.body.generationConfig.maxOutputTokens === 60 + HEADROOM, 'native request: systemInstruction, contents, responseMimeType, responseJsonSchema, maxOutputTokens');
  ok(Object.keys(q.body).every(k => ['systemInstruction', 'contents', 'generationConfig'].includes(k)) && Object.keys(q.body.generationConfig).every(k => ['maxOutputTokens', 'responseMimeType', 'responseJsonSchema'].includes(k)), 'native request carries no other field');
  ok(r.usage.in === 700 && r.usage.out === 100 && r.usage.cost === 0 && r.model === NOSCHEMA, 'usage from usageMetadata, thoughtsTokenCount counted as output; thought parts are not the answer');
  await ad.call({system: 's', user: 'u', schema, maxTokens: 60, model: NOSCHEMA}); ok(compat.length === c0 + 1 && native.length === n0 + 2 && ad.nativeModels().includes(NOSCHEMA), '... remembered for that model (no second compat try)');
  const all = mk({nativeAlways: true}), c1 = compat.length; await all.call({system: 's', user: 'u', schema, maxTokens: 60, model: G38});
  ok(compat.length === c1 && lastN().url.includes(G38), 'GOOGLE_NATIVE=1 sends structured calls natively');
  ok(googleFromEnv({GOOGLE_API_KEY: KEY, GOOGLE_NATIVE: '1'}).name === 'google', 'GOOGLE_NATIVE is read from the environment');
  st.mode = 'cut'; let e = await err(all.call({system: 's', user: 'u', schema, maxTokens: 60, model: G38}));
  ok(e && e.message === 'reply cut off', 'finishReason MAX_TOKENS -> "reply cut off"');
  st.mode = 'safety'; e = await err(all.call({system: 's', user: 'u', schema, maxTokens: 60, model: G38}));
  ok(e && /model refused/.test(e.message), 'finishReason SAFETY -> "model refused"');
  st.mode = 'blocked'; e = await err(all.call({system: 's', user: 'u', schema, maxTokens: 60, model: G38}));
  ok(e && /model refused/.test(e.message), 'a blocked prompt (promptFeedback.blockReason) -> "model refused"');
  st.mode = 'daily'; e = await err(all.call({system: 's', user: 'u', schema, maxTokens: 60, model: G38}));
  ok(e && e.kind === 'quota', 'native errors are mapped the same way (daily quota)'); st.mode = 'ok';
  const f = await all.chat({model: G38, messages: [{role: 'system', content: 'sys'}, {role: 'user', content: 'scene'}], format: schema, strict: true});
  ok(lastN().url.includes(G38) && f.message.content === '{"line":"The fen keeps its counsel."}', 'a forced scene answer (chat with a strict format) takes the same native path');
}

console.log('tool calls and thought signatures');
{
  const ad = mk(), c = await ad.chat({model: SIG, messages: [{role: 'user', content: 'hi'}], tools: ollamaTools()}), q = lastC();
  ok(c.message.tool_calls && c.message.tool_calls[0].function.name === 'status' && c.message.tool_calls[0].extra_content.google.thought_signature === 'sig-abc' && Array.isArray(q.tools) && q.reasoning_effort === 'low', 'chat(): tool call parsed with its thought signature kept');
  const back = toOpenAI([{role: 'user', content: 'hi'}, c.message, {role: 'tool', tool_name: 'status', content: '{}'}]);
  ok(back[1].tool_calls[0].extra_content.google.thought_signature === 'sig-abc' && back[2].role === 'tool', 'toOpenAI sends the signature back on the call');
  const calls = [], game = async tool => {calls.push(tool); return {ok: true}};
  const r = await localTurn({chat: ad.chat, call: game, sess: {system: 'You are Ann.'}, prompt: 'Begin.', model: SIG});
  ok(calls[0] === 'status' && r.narration === 'The hero looked about.' && r.cost === 0 && r.costKnown !== false, 'a loop turn on a signature model: the signature goes back within the turn and the model answers');
  const sess = {system: 'You are Ann.'}; await localTurn({chat: ad.chat, call: game, sess, prompt: 'Begin.', model: G38});
  ok(!JSON.stringify(sess.local || {}).includes('sig-abc'), 'signatures stay out of the kept history');
  const n = compat.length, flat = await ad.chat({model: SIG, messages: [{role: 'user', content: 'go'}, {role: 'assistant', content: '', tool_calls: [{function: {name: 'status', arguments: {}}}]}, {role: 'tool', tool_name: 'status', content: '{"ok":true}'}], tools: ollamaTools()});
  ok(compat.length === n + 2 && !compat[compat.length - 1].messages.some(m => m.tool_calls) && /I called status/.test(JSON.stringify(compat[compat.length - 1].messages)) && !!(flat.message.content || flat.message.tool_calls), 'a 400 for a missing signature is asked once more with the calls written out as text');
  ok(flattenCalls([{role: 'tool', content: 'x'}])[0].role === 'user', 'flattenCalls turns tool results into user text');
}

console.log('limiter');
{
  const lim = makeLimiter({max: 4, rpm: 600}), at = [];
  await Promise.all([0, 1, 2].map(() => lim.run(async () => {at.push(Date.now())}, {urgent: true})));
  ok(at.length === 3 && at[1] - at[0] >= 90 && at[2] - at[1] >= 90 && lim.stats().rpm === 600, 'rpm spaces the starts evenly (RELAY_GOOGLE_RPM)');
  ok(rateLimitOf({status: 429, kind: 'quota'}) === null && rateLimitOf({status: 429}) !== null, 'a quota 429 is never retried; a plain 429 still is');
}

console.log('google through the relay');
{
  const env = {GOOGLE_API_KEY: KEY, GOOGLE_BASE_URL: url, GOOGLE_MODEL: G38}, lines = [];
  ok(PROVIDERS.includes('google') && !isLocal('google'), 'google is a relay provider, not local');
  const lim = makeLimits({RELAY_GOOGLE_RPM: '120'}); ok(lim.google && lim.google !== lim.openai && lim.google.stats().max === 4 && lim.google.stats().rpm === 120, 'google has its own limiter (RELAY_GOOGLE_CONCURRENCY default 4, RELAY_GOOGLE_RPM)');
  const mr = createRelay({client: null, providers: makeProviders({env}), limits: makeLimits({}), timeoutMs: 1500, log: m => lines.push(m)});
  await new Promise(r => mr.server.listen(0, '127.0.0.1', r));
  const mb = `http://127.0.0.1:${mr.server.address().port}`, post = body => fetch(mb + '/decide', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)});
  let r = await post({...town, provider: 'google', model: G25}), j = await r.json();
  ok(r.status === 200 && j.choice === 'Thornvale' && j.provider === 'google' && j.model === G25, 'townPlan: a valid answer, provider google');
  r = await post({...town, provider: 'google'}); j = await r.json(); ok(r.status === 200 && j.model === G38 && j.usage.cost === 0, 'no model in the request -> GOOGLE_MODEL; free tier cost $0');
  r = await post({...town, provider: 'google', model: NOSCHEMA}); j = await r.json(); ok(r.status === 200 && j.choice === 'Thornvale', 'a model whose compat layer rejects the schema still answers (native, validated)');
  st.mode = 'daily'; r = await post({...town, provider: 'google'}); j = await r.json(); ok(r.status === 502 && /free quota used up/.test(j.error), 'the daily quota used up: the request fails (scripted plays)'); st.mode = 'ok';
  r = await fetch(mb + '/health'); j = await r.json();
  ok(j.providers.google.ok && j.providers.google.models.includes(G38) && !j.providers.google.models.some(m => /embedding|live|image/.test(m)) && j.providers.google.default === G38 && j.providers.google.free && !j.providers.google.local && j.queues.google, '/health lists the chat models, the default, the free tier and the queue');
  ok(!lines.concat([JSON.stringify(j)]).some(l => l.includes(KEY)), 'the key appears in no log line or /health');
  await new Promise(r => mr.server.close(r));
  const gp = makeProviders({env: {...env, GOOGLE_MODELS: G25 + ',' + G38}}).google, gs = await gp.status();
  ok(JSON.stringify(gs.models) === JSON.stringify([G25, G38]), 'GOOGLE_MODELS narrows the list through modelListFrom (in the order given)');
}

console.log('runner checks and mind tables');
{
  const a = await openaiRunner({provider: 'google', model: null}, {}, {});
  ok(a.error && /GOOGLE_API_KEY/.test(a.error) && /aistudio\.google\.com\/apikey/.test(a.error), 'a google runner without GOOGLE_API_KEY says so and where to get one');
  const b = await openaiRunner({provider: 'google', model: 'claude-haiku-5-5'}, {GOOGLE_API_KEY: KEY, GOOGLE_BASE_URL: url}, {explicit: false});
  ok(b.error && /No Gemini model chosen/.test(b.error) && b.error.includes(G38), 'a saved Claude model is dropped; no model -> asks for --model or GOOGLE_MODEL and lists the key\'s models');
  const c = await openaiRunner({provider: 'google', model: G38}, {GOOGLE_API_KEY: KEY, GOOGLE_BASE_URL: url}, {explicit: true});
  ok(c.adapter && c.adapter.name === 'google' && c.model === G38 && /free tier/.test(c.note), 'a google runner gets the google adapter, free tier noted');
  const d = await openaiRunner({provider: 'google', model: 'gemini-9-nope'}, {GOOGLE_API_KEY: KEY, GOOGLE_BASE_URL: url}, {explicit: true});
  ok(d.error && /not in this key's model list/.test(d.error), 'a model the key does not list is refused with the list');
  ok(isCompat('google') && compatLabel('google') === 'Gemini', 'google runs on the Chat Completions loop, labelled Gemini');
  ok(RUNNER_PROVIDERS.includes('google') && SETUP_PROVIDERS.includes('google') && MIND_PROVIDERS.includes('google') && DM_PROVIDERS.includes('google') && PROVIDER_LABEL.google === 'Gemini', 'runner, setup, mind and DM provider tables include google');
  ok(modelTag({provider: 'google', model: G38}) === G38 + ' · google' && modelTag({provider: 'openai', model: 'gpt-6-luna'}) === 'gpt-6-luna · openai' && modelTag({provider: 'ollama', model: 'q:1b'}) === 'q:1b · local' && modelTag({provider: 'anthropic', model: 'claude-haiku-5-5'}) === 'claude-haiku-5-5', 'the model tag reads "gemini-<id> · google" (others unchanged)');
  const s = checkStart({kind: 'hero', hero: 7, provider: 'google', model: G38}, [{id: 7, name: 'Ann', alive: true}], {});
  ok(!s.error && s.req.provider === 'google' && s.req.model === G38 && s.req.budget > 0, 'the runner start accepts provider google (it keeps a budget, takes no Claude slot)' + (s.error ? ': ' + s.error : ''));
  const sd = checkStart({kind: 'dm', provider: 'google', model: G38}, [], {});
  ok(!sd.error && sd.req.provider === 'google', 'a DM runner may start with google' + (sd.error ? ': ' + sd.error : ''));
}

const tmp = mkTmp('eldmoor-googlecheck-'), kids = [];
const env = {...process.env, AGENT_LOGS: tmp, ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', HF_TOKEN: '', GOOGLE_API_KEY: KEY, GOOGLE_BASE_URL: url, AGENT_MIN_GAP: '0', AGENT_HEARTBEAT: '30', AGENT_REFLECT: '0', RELAY_VERBOSE: ''};
delete env.GOOGLE_MODEL; delete env.GOOGLE_TIER; delete env.GOOGLE_NATIVE;
const start = (args, {wait: ready = null, e = env} = {}) => {
  const p = spawn(process.execPath, args, {cwd: ROOT, env: e, stdio: ['ignore', 'pipe', 'pipe']}); kids.push(p); let out = '';
  p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
  const done = new Promise(r => p.on('exit', code => r(code)));
  const until = ready ? new Promise((res, rej) => {const t = setInterval(() => {if (ready.test(out)) {clearInterval(t); res()}}, 100); setTimeout(() => {clearInterval(t); rej(new Error('timeout waiting for ' + ready + '\n' + out))}, 120000)}) : null;
  return {p, done, until, out: () => out};
};
try {
  console.log('npm run agent -- --provider google (mock Gemini, headless world)');
  {
    const port = 19960 + Math.floor(Math.random() * 30), BASE = `http://127.0.0.1:${port}`, health = () => fetch(BASE + '/play/health').then(r => r.json());
    const world = start(['scripts/play-headless.mjs', '--port', String(port), '--agents', '2', '--quiet', '--speed', '8', '--world', join(tmp, 'world.json')], {wait: /^\[play\] headless world at /m});
    await world.until;
    const [hA, hB] = (await health()).heroes;
    const run = start(['scripts/agent-player.mjs', '--url', BASE, '--hero', String(hA.id), '--provider', 'google', '--model', G38, '--max-turns', '2', '--budget', '1']);
    let tagged = null, exited = false; run.done.then(() => {exited = true});
    for (let i = 0; i < 600 && !exited && !tagged; i++) {await sleep(100); const h = await health().catch(() => null); const x = h && h.heroes.find(y => y.id === hA.id); if (x && x.runner) tagged = x}
    ok(tagged && tagged.runner.provider === 'google' && tagged.runner.model === G38, 'while it runs, the claim tags the runner: ' + (tagged && JSON.stringify(tagged.runner)));
    const code = await run.done, out = run.out();
    ok(code === 0, 'the google runner exits cleanly' + (code ? '\n' + out.slice(-1500) : ''));
    ok(/via Gemini/.test(out) && /> status\(\)/.test(out) && /free tier/.test(out), 'it plays through the game tools, free tier noted');
    ok((out.match(/\[turn \d\] .*\(google\).*\| turn \$0\.0000 \| run \$0\.0000 \| session \$/g) || []).length === 2, 'two turn lines with cost $0 (free tier) and the "| run $" the app runner reads');
    const f = join(tmp, 'agents', hA.id + '.json'), sf = existsSync(f) && JSON.parse(readFileSync(f, 'utf8'));
    ok(sf && sf.runner.provider === 'google' && sf.runner.model === G38 && sf.turns === 2, 'the session file keeps runner {provider: google, model} and the turns');
    ok(!out.includes(KEY), 'the key is not in the runner output');
    const nt = start(['scripts/agent-player.mjs', '--url', BASE, '--hero', String(hB.id), '--provider', 'google', '--model', G38, '--max-turns', '1', '--new'], {e: {...env, GOOGLE_API_KEY: ''}}); const c2 = await nt.done;
    ok(c2 === 1 && /No GOOGLE_API_KEY/.test(nt.out()), 'no key: refused with the steps to create one');
    world.p.kill();
  }
  console.log('npm run dm -- --provider google (mock Gemini, headless world)');
  {
    const port = 19920 + Math.floor(Math.random() * 30), BASE = `http://127.0.0.1:${port}`;
    const world = start(['scripts/play-headless.mjs', '--port', String(port), '--dm', '--agents', '0', '--quiet', '--speed', '4', '--world', join(tmp, 'dmworld.json')], {wait: /^\[play\] headless world at /m});
    await world.until;
    const dm = start(['scripts/dm-agent.mjs', '--url', BASE, '--provider', 'google', '--model', G38, '--max-turns', '2', '--cadence', '5', '--claude-concurrency', '1']);
    let live = null, exited = false; dm.done.then(() => {exited = true});
    for (let i = 0; i < 600 && !exited && !(live && live.runner); i++) {await sleep(100); const h = await fetch(BASE + '/play/health').then(r => r.json()).catch(() => null); live = h && h.dm}
    ok(live && live.claimed && live.runner && live.runner.provider === 'google' && live.runner.model === G38, 'while it runs, the DM seat is claimed and tagged google ' + (live && live.runner && live.runner.model));
    const code = await dm.done, out = dm.out();
    ok(code === 0, 'the Gemini DM exits cleanly after --max-turns' + (code === 0 ? '' : '\n' + out.slice(-1500)));
    ok(/DM seat taken \| model gemini-3\.8-flash via Gemini \(free tier\)/.test(out) && /> dm_status\(\)/.test(out) && /table voice: gemini-3\.8-flash \(Gemini\)/.test(out) && /ruling voice: gemini-3\.8-flash \(Gemini\)/.test(out), 'it reads through the DM tools, with Gemini table, talk and ruling voices');
    ok(/\[turn 1\] gemini-3\.8-flash \(google\) .*\| turn \$0\.0000/.test(out) && /\(Gemini free tier\)/.test(out), 'a cost line per turn and the run total');
    const f = join(tmp, 'agents', 'dm.json'), s = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
    ok(s && s.turns === 2 && s.runner.provider === 'google' && s.runner.model === G38 && s.local && s.local.history.length > 0, 'logs/agents/dm.json keeps runner {provider: google, model}, the turns and the conversation');
    ok(!out.includes(KEY), 'the key is not in the DM output');
    world.p.kill();
  }
  await dmMindCases({provider: 'google', model: DMPLAN, env, ok, port: 19860 + Math.floor(Math.random() * 30) * 3, seen: compat}); // #824: the same cases as OpenAI and the router; the free tier has no budget stop
} finally {
  for (const k of kids) try {k.kill()} catch {}
  try {rmSync(tmp, {recursive: true, force: true})} catch {}
  server.close();
}
if (fail) {console.error(`\n${fail} check(s) FAILED`); process.exit(1)}
console.log('\ngooglecheck: all ok (mock Gemini only; no live Google call was made)');
