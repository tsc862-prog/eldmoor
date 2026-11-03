// Hugging Face router provider check (issue #552). No network and no token: a mock OpenAI-compatible
// server on a free port stands in for router.huggingface.co; nothing here reads HF_TOKEN from the real
// environment or .env. Checks: the adapter (token only in the Authorization header, free tier: cost 0, no
// paid or reasoning options in a request, max_tokens, models list, 401/402/429 mapped, token never in an
// error), the relay (/decide with provider hf, /health providers.hf, its own limiter), the agent loop over
// the adapter's chat(), the runner start checks (provider hf accepted) and the mind tables.
// Usage: npm run hfcheck
import http from 'node:http';
import {hfAdapter, openaiAdapter, HF_URL} from './providers/openai.mjs';
import {makeProviders, PROVIDERS, isLocal} from './providers/index.mjs';
import {createRelay, makeLimits} from './relay.mjs';
import {localTurn, ollamaTools} from './local-agent.mjs';
import {openaiRunner} from './agent-chat.mjs';
import {RUNNER_PROVIDERS} from './agent-sessions.mjs';
import {checkStart} from './runners.mjs';
import {MIND_PROVIDERS, PROVIDER_LABEL, modelTag} from '../src/sim/brain.js';
import {SETUP_PROVIDERS} from '../src/sim/setup.js';

let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
const TOKEN = 'hf_testtoken1234567890', MODELS = ['Qwen/Qwen3-32B', 'meta-llama/Llama-3.3-70B-Instruct', 'zai-org/GLM-4.6'];
const seen = [], st = {mode: 'ok', rateLeft: 0};
const answer = f => {const p = f && f.properties || {};
  if (p.choice) return {choice: p.choice.enum[0], crypt: false, reason: 'The fen keeps its counsel.', line: 'Hold.'};
  if (p.long) return {long: 'I remember the fen.'}; if (p.crypt) return {crypt: true, reason: 'Why not.'}; return {line: 'Mud and patience.'}};
const server = http.createServer((req, res) => {
  const send = (code, o, h = {}) => {res.writeHead(code, {'content-type': 'application/json', ...h}); res.end(JSON.stringify(o))};
  if (req.headers.authorization !== 'Bearer ' + TOKEN) return send(401, {error: {message: 'Invalid token ' + String(req.headers.authorization || '').replace('Bearer ', '')}});
  if (req.method === 'GET' && req.url === '/v1/models') return send(200, {object: 'list', data: MODELS.map(id => ({id, object: 'model'}))});
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') return send(404, {error: {message: 'not found'}});
  let b = ''; req.on('data', c => b += c); req.on('end', () => {
    const body = JSON.parse(b); seen.push(body);
    if ('reasoning_effort' in body) return send(400, {error: {message: 'Unrecognized request argument supplied: reasoning_effort'}});
    if (st.mode === 'quota') return send(402, {error: 'You have exceeded your monthly included credits for Inference Providers.'});
    if (st.mode === 'rate' && st.rateLeft > 0) {st.rateLeft--; return send(429, {error: {message: 'Rate limit reached'}}, {'retry-after': '1'})}
    const usage = {prompt_tokens: 800, completion_tokens: 15, total_tokens: 815};
    const reply = (message, finish = 'stop') => send(200, {id: 'x', object: 'chat.completion', model: body.model, usage, choices: [{index: 0, finish_reason: finish, message}]});
    const rf = body.response_format;
    if (rf && rf.type === 'json_schema') return reply({role: 'assistant', content: JSON.stringify(answer(rf.json_schema.schema))});
    const n = body.messages.filter(m => m.role === 'tool').length;
    if (body.tools && n < 1) return reply({role: 'assistant', content: null, tool_calls: [{id: 'call_1', type: 'function', function: {name: 'status', arguments: '{}'}}]}, 'tool_calls');
    reply({role: 'assistant', content: 'The hero looked about.'});
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/v1`;
const err = async p => {try {await p; return null} catch (e) {return e}};
const schema = {type: 'object', additionalProperties: false, required: ['line'], properties: {line: {type: 'string'}}};
const town = {kind: 'townPlan', snapshot: {fac: 'Warband', name: 'Test', options: ['Thornvale', 'Mirefen']}};

console.log('hf adapter (mock server)');
{
  ok(HF_URL === 'https://router.huggingface.co/v1', 'default base URL is the Hugging Face router');
  const ad = hfAdapter({apiKey: TOKEN, baseUrl: url});
  ok(ad.name === 'hf' && ad.free && !ad.local && ad.configured() && ad.defaultModel === null, 'named hf, free, remote, no default model in code');
  const s = await ad.status();
  ok(s.ok && s.models.length === 3 && s.models.includes('Qwen/Qwen3-32B') && /HF_MODEL/.test(s.note || ''), 'status lists the router models (no chat filter) and asks for HF_MODEL');
  const r = await ad.call({system: 'You are a hero.', user: '{"x":1}', schema, maxTokens: 60, model: 'Qwen/Qwen3-32B'}), q = seen[seen.length - 1];
  ok(r.text === '{"line":"Mud and patience."}' && r.usage.in === 800 && r.usage.out === 15 && r.usage.cost === 0 && r.usage.costKnown === true, 'a decision: tokens counted, cost 0 and known (free allowance)');
  ok(q.model === 'Qwen/Qwen3-32B' && q.max_tokens === 60 && !('max_completion_tokens' in q) && !('reasoning_effort' in q), 'request: the model id as given, max_tokens, no reasoning_effort');
  ok(Object.keys(q).every(k => ['model', 'max_tokens', 'response_format', 'messages'].includes(k)), 'request carries no other option, so nothing paid (' + Object.keys(q).join(',') + ')');
  let e = await err(ad.call({system: 's', user: 'u', schema, maxTokens: 60}));
  ok(e && /hf: no model chosen/.test(e.message), 'no model -> asks to pick one');
  st.mode = 'quota'; e = await err(ad.call({system: 's', user: 'u', schema, maxTokens: 60, model: 'Qwen/Qwen3-32B'}));
  ok(e && e.kind === 'quota' && /free allowance used up/.test(e.message), 'HTTP 402 -> "free allowance used up", never retried or charged');
  st.mode = 'rate'; st.rateLeft = 1; e = await err(ad.call({system: 's', user: 'u', schema, maxTokens: 60, model: 'Qwen/Qwen3-32B'}));
  ok(e && e.kind === 'rate' && e.retryAfter === 1 && e.headers && e.headers['retry-after'] === '1', 'a 429 -> rate limit with retry-after for the relay limiter'); st.mode = 'ok';
  const bad = hfAdapter({apiKey: 'hf_wrongtoken0000', baseUrl: url});
  e = await err(bad.call({system: 's', user: 'u', schema, maxTokens: 60, model: 'x/y'})); const bs = await bad.status();
  ok(e && e.kind === 'auth' && !e.message.includes('hf_wrongtoken0000') && !bs.ok && /bad or missing key/.test(bs.error), 'a bad token -> auth error without the token in it');
  const none = hfAdapter({apiKey: null, baseUrl: url}), ns = await none.status();
  ok(!ns.ok && /no HF_TOKEN/.test(ns.error) && !none.configured(), 'no token -> not configured, says HF_TOKEN');
  const oa = openaiAdapter({apiKey: 'sk-x', baseUrl: url}); ok(oa.name === 'openai' && !oa.free, 'the OpenAI adapter is unchanged by the options');
  const c = await ad.chat({model: 'Qwen/Qwen3-32B', messages: [{role: 'user', content: 'hi'}], tools: ollamaTools()}), cq = seen[seen.length - 1];
  ok(c.message.tool_calls && c.message.tool_calls[0].function.name === 'status' && c.usage.cost === 0 && cq.max_tokens === 600 && Array.isArray(cq.tools) && !('reasoning_effort' in cq), 'chat(): tool call parsed, cost 0, max_tokens, no reasoning_effort');
}

console.log('hf through the relay');
{
  const env = {HF_TOKEN: TOKEN, HF_BASE_URL: url, HF_MODEL: 'Qwen/Qwen3-32B'}, lines = [];
  ok(PROVIDERS.includes('hf') && !isLocal('hf'), 'hf is a relay provider, not local');
  const lim = makeLimits({}); ok(lim.hf && lim.hf !== lim.openai, 'hf has its own limiter (RELAY_HF_CONCURRENCY)');
  const mr = createRelay({client: null, providers: makeProviders({env}), limits: lim, timeoutMs: 1500, log: m => lines.push(m)});
  await new Promise(r => mr.server.listen(0, '127.0.0.1', r));
  const mb = `http://127.0.0.1:${mr.server.address().port}`, post = body => fetch(mb + '/decide', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)});
  let r = await post({...town, provider: 'hf', model: 'meta-llama/Llama-3.3-70B-Instruct'}), j = await r.json();
  ok(r.status === 200 && j.choice === 'Thornvale' && j.provider === 'hf' && j.model === 'meta-llama/Llama-3.3-70B-Instruct' && j.usage.cost === 0, 'townPlan: a valid answer, provider hf, cost 0');
  r = await post({...town, provider: 'hf'}); j = await r.json(); ok(r.status === 200 && j.model === 'Qwen/Qwen3-32B', 'no model in the request -> HF_MODEL');
  st.mode = 'quota'; r = await post({...town, provider: 'hf'}); j = await r.json(); ok(r.status === 502 && /free allowance used up/.test(j.error), 'an exhausted allowance: the request fails (scripted plays)'); st.mode = 'ok';
  r = await fetch(mb + '/health'); j = await r.json();
  ok(j.providers.hf.ok && j.providers.hf.models.includes('zai-org/GLM-4.6') && j.providers.hf.default === 'Qwen/Qwen3-32B' && !j.providers.hf.local && j.queues.hf, '/health lists the router models and the hf queue');
  ok(!lines.concat([JSON.stringify(j)]).some(l => l.includes(TOKEN)), 'the token appears in no log line or /health');
  await new Promise(r => mr.server.close(r));
}

console.log('agent loop, runners and mind tables');
{
  const ad = hfAdapter({apiKey: TOKEN, baseUrl: url}), calls = [], game = async tool => {calls.push(tool); return {ok: true}};
  const r = await localTurn({chat: ad.chat, call: game, sess: {system: 'You are Ann.'}, prompt: 'Begin.', model: 'Qwen/Qwen3-32B'});
  ok(calls[0] === 'status' && r.narration === 'The hero looked about.' && r.cost === 0 && r.costKnown !== false, 'a turn over hf chat(): the tool reaches the game, narration, cost 0');
  const a = await openaiRunner({provider: 'hf', model: null}, {}, {});
  ok(a.error && /HF_TOKEN/.test(a.error) && !/OPENAI/.test(a.error), 'a hf runner without HF_TOKEN says so');
  const b = await openaiRunner({provider: 'hf', model: null}, {HF_TOKEN: TOKEN, HF_BASE_URL: url}, {explicit: false});
  ok(b.error && /No Hugging Face model chosen/.test(b.error), 'no model -> asks for --model or HF_MODEL');
  const c = await openaiRunner({provider: 'hf', model: 'Qwen/Qwen3-32B'}, {HF_TOKEN: TOKEN, HF_BASE_URL: url}, {explicit: true});
  ok(c.adapter && c.adapter.name === 'hf' && c.model === 'Qwen/Qwen3-32B', 'a hf runner gets the hf adapter');
  ok(RUNNER_PROVIDERS.includes('hf') && SETUP_PROVIDERS.includes('hf') && MIND_PROVIDERS.includes('hf') && PROVIDER_LABEL.hf === 'Hugging Face', 'runner, setup and mind provider tables include hf');
  ok(modelTag({provider: 'hf', model: 'Qwen/Qwen3-32B'}) === 'Qwen/Qwen3-32B · hf', 'the model tag reads "model · hf"');
  const s = checkStart({kind: 'hero', hero: 7, provider: 'hf', model: 'Qwen/Qwen3-32B'}, [{id: 7, name: 'Ann', alive: true}], {});
  ok(!s.error && s.req.provider === 'hf' && s.req.model === 'Qwen/Qwen3-32B', 'the runner start accepts provider hf with an org/model id' + (s.error ? ': ' + s.error : ''));
}
server.close();
if (fail) {console.error(`\n${fail} check(s) FAILED`); process.exit(1)}
console.log('\nhfcheck: all ok');
