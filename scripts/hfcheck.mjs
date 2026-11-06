// Hugging Face router provider check (issue #552). No network and no token: a mock OpenAI-compatible router
// on a free port stands in for router.huggingface.co; nothing here reads HF_TOKEN from the real environment
// or .env. Checks: the adapter (curated model list verified with one tiny call per model, model_not_supported
// dropped, strict json_schema first with a json_object fallback, no reasoning_effort, cost = usage.estimated_cost
// or unknown, 401/402/429 mapped, the token never in an error), the relay (/decide with provider huggingface,
// /health, its own limiter), the agent loop (tools, JSON-actions fallback), the runner start checks, the mind
// tables, and a real `agent-player.mjs --provider huggingface` run against a headless world.
// Usage: npm run hfcheck
import {mkTmp} from './tmp.mjs';
import {dmMindCases} from './dm-mind-cases.mjs';
import {schemaFill, toolsProblem, isDmTurn, dmTurnMessage} from './mock-dm.mjs';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync, readFileSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {hfAdapter, openaiAdapter, HF_URL, HF_MODELS, hfModelList} from './providers/openai.mjs';
import {makeProviders, PROVIDERS, isLocal} from './providers/index.mjs';
import {createRelay, makeLimits} from './relay.mjs';
import {localTurn, ollamaTools} from './local-agent.mjs';
import {openaiRunner} from './agent-chat.mjs';
import {RUNNER_PROVIDERS} from './agent-sessions.mjs';
import {checkStart} from './runners.mjs';
import {MIND_PROVIDERS, PROVIDER_LABEL, modelTag} from '../src/sim/brain.js';
import {SETUP_PROVIDERS} from '../src/sim/setup.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TOKEN = 'hf_testtoken1234567890';
const L8 = 'meta-llama/Llama-3.1-8B-Instruct', Q7 = 'Qwen/Qwen2.5-7B-Instruct', NOSCHEMA = 'org/no-schema', NOTOOLS = 'org/no-tools', NOCOST = 'org/no-cost', PRICEY = 'org/pricey';
const CURATED = [L8, Q7, NOSCHEMA, NOTOOLS, NOCOST], COST = 0.000004;
const seen = [], st = {mode: 'ok', rateLeft: 0};
const answer = f => {const p = f && f.properties || {};
  if (p.choice) return {choice: p.choice.enum[0], crypt: false, reason: 'The fen keeps its counsel.', line: 'Hold.'};
  if (p.text) return schemaFill(f); // a DM voice
  if (p.long) return {long: 'I remember the fen.'}; if (p.crypt) return {crypt: true, reason: 'Why not.'}; return {line: 'Mud and patience.'}};
const server = http.createServer((req, res) => {
  const send = (code, o, h = {}) => {res.writeHead(code, {'content-type': 'application/json', ...h}); res.end(JSON.stringify(o))};
  if (req.headers.authorization !== 'Bearer ' + TOKEN) return send(401, {error: {message: 'Invalid token ' + String(req.headers.authorization || '').replace('Bearer ', '')}});
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') return send(404, {error: {message: 'not found'}});
  let b = ''; req.on('data', c => b += c); req.on('end', () => {
    const body = JSON.parse(b); seen.push(body);
    if ('reasoning_effort' in body) return send(400, {error: {message: 'Unrecognized request argument supplied: reasoning_effort'}});
    if (body.model === Q7) return send(400, {error: {code: 'model_not_supported', message: "The requested model '" + Q7 + "' is not supported by any provider you have enabled."}});
    if (st.mode === 'quota') return send(402, {error: 'You have exceeded your monthly included credits for Inference Providers. Purchase more credits.'});
    if (st.mode === 'rate' && st.rateLeft > 0) {st.rateLeft--; return send(429, {error: {message: 'Rate limit reached'}}, {'retry-after': '1'})}
    const rf = body.response_format;
    if (body.model === NOSCHEMA && rf && rf.type === 'json_schema') return send(400, {error: {message: 'response_format json_schema is not supported by this provider'}});
    if (body.model === NOTOOLS && body.tools) return send(400, {error: {message: 'Tool use is not supported for this model'}});
    const tp = toolsProblem(body); if (tp) return send(400, {error: {message: tp}});
    const usage = {prompt_tokens: 800, completion_tokens: 15, total_tokens: 815, prompt_tokens_details: {cached_tokens: 600}, ...(body.model === NOCOST ? {} : {estimated_cost: body.model === PRICEY ? .011 : COST})};
    const reply = (message, finish = 'stop') => send(200, {id: 'x', object: 'chat.completion', model: body.model, usage, choices: [{index: 0, finish_reason: finish, message}]});
    if (rf && rf.type === 'json_schema') return reply({role: 'assistant', content: JSON.stringify(answer(rf.json_schema.schema))});
    if (rf && rf.type === 'json_object') {
      const sys = body.messages[0] && body.messages[0].content || '', m = /matching this JSON schema: (.*)$/s.exec(sys);
      return reply({role: 'assistant', content: JSON.stringify(m ? answer(JSON.parse(m[1])) : {tool: 'end', args: {}, narration: 'The hero waited.'})});
    }
    if (isDmTurn(body)) {const m = dmTurnMessage(body); return reply(m, m.tool_calls ? 'tool_calls' : 'stop')}
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
const mk = (o = {}) => hfAdapter({apiKey: TOKEN, baseUrl: url, models: CURATED, ...o});

console.log('huggingface adapter (mock router)');
{
  ok(HF_URL === 'https://router.huggingface.co/v1' && HF_MODELS.length >= 4 && hfModelList({}).join() === HF_MODELS.join() && hfModelList({HF_MODELS: 'a/b, c/d'}).join() === 'a/b,c/d', 'default router URL, curated default list, HF_MODELS overrides it');
  const ad = mk();
  ok(ad.name === 'huggingface' && !ad.local && ad.configured() && ad.defaultModel === null, 'named huggingface, remote, no default model in code');
  const n0 = seen.length, s = await ad.status();
  ok(s.ok && s.verified && JSON.stringify(s.models) === JSON.stringify([L8, NOSCHEMA, NOTOOLS, NOCOST]) && s.dropped.join() === Q7 && /free allowance with the art pipeline/.test(s.note), 'status verifies each curated model with one tiny call and drops the model_not_supported one');
  ok(seen.length === n0 + 5 && seen.slice(n0).every(q => q.max_tokens === 1), 'one tiny call per model (max_tokens 1)');
  await ad.status(); ok(seen.length === n0 + 5, "the verified list is cached for the adapter's life");
  const r = await ad.call({system: 'You are a hero.', user: '{"x":1}', schema, maxTokens: 60, model: L8}), q = seen[seen.length - 1];
  ok(r.text === '{"line":"Mud and patience."}' && r.usage.in === 800 && r.usage.out === 15 && r.usage.cost === COST && r.usage.costKnown === true, "a decision: cost is the reply's usage.estimated_cost");
  ok(r.usage.cached === 600 && r.usage.cost === COST, "cached tokens are counted for the turn line, the cost stays the reply's estimated_cost (#728)");
  ok(q.model === L8 && q.max_tokens === 60 && !('max_completion_tokens' in q) && !('reasoning_effort' in q) && q.response_format.type === 'json_schema' && q.response_format.json_schema.strict === true, 'request: strict json_schema first, max_tokens, no reasoning_effort');
  ok(Object.keys(q).every(k => ['model', 'max_tokens', 'response_format', 'messages'].includes(k)), 'request carries no other option (' + Object.keys(q).join(',') + ')');
  const u = await ad.call({system: 's', user: 'u', schema, maxTokens: 60, model: NOCOST});
  ok(u.usage.costKnown === false && u.usage.cost === 0 && u.usage.costNote === 'unknown', 'a reply with no estimated_cost: cost unknown');
  const n1 = seen.length, v = await ad.call({system: 'You are a hero.', user: 'u', schema, maxTokens: 60, model: NOSCHEMA}), q2 = seen[seen.length - 1];
  ok(seen.length === n1 + 2 && q2.response_format.type === 'json_object' && /matching this JSON schema/.test(q2.messages[0].content) && v.text === '{"line":"Mud and patience."}', 'a provider that rejects json_schema is asked again with json_object + the schema in the prompt');
  await ad.call({system: 's', user: 'u', schema, maxTokens: 60, model: NOSCHEMA}); ok(seen.length === n1 + 3, '... and remembered for that model');
  let e = await err(ad.call({system: 's', user: 'u', schema, maxTokens: 60}));
  ok(e && /huggingface: no model chosen/.test(e.message), 'no model -> asks to pick one');
  e = await err(ad.call({system: 's', user: 'u', schema, maxTokens: 60, model: Q7}));
  ok(e && e.kind === 'model' && /not supported/.test(e.message) && e.message.includes(L8) && !e.message.includes(Q7 + ','), 'model_not_supported names the picker list');
  st.mode = 'quota'; e = await err(ad.call({system: 's', user: 'u', schema, maxTokens: 60, model: L8}));
  ok(e && e.kind === 'quota' && /Hugging Face allowance used up \(recharge is off\); the hero plays scripted \/ the runner waits/.test(e.message), 'HTTP 402 -> "Hugging Face allowance used up (recharge is off)...", never retried');
  st.mode = 'rate'; st.rateLeft = 1; e = await err(ad.call({system: 's', user: 'u', schema, maxTokens: 60, model: L8}));
  ok(e && e.kind === 'rate' && e.retryAfter === 1 && e.headers && e.headers['retry-after'] === '1', 'a 429 -> rate limit with retry-after for the relay limiter'); st.mode = 'ok';
  const bad = mk({apiKey: 'hf_wrongtoken0000'});
  e = await err(bad.call({system: 's', user: 'u', schema, maxTokens: 60, model: L8})); const bs = await bad.status();
  ok(e && e.kind === 'auth' && /bad or missing HF_TOKEN/.test(e.message) && !e.message.includes('hf_wrongtoken0000') && !bs.ok && /bad or missing HF_TOKEN/.test(bs.error), 'a bad token -> "bad or missing HF_TOKEN" without the token in it');
  const none = mk({apiKey: null}), ns = await none.status();
  ok(!ns.ok && /no HF_TOKEN/.test(ns.error) && !none.configured(), 'no token -> not configured, says HF_TOKEN');
  const oa = openaiAdapter({apiKey: 'sk-x', baseUrl: url}); ok(oa.name === 'openai' && !oa.free, 'the OpenAI adapter is unchanged by the options');
  const c = await ad.chat({model: L8, messages: [{role: 'user', content: 'hi'}], tools: ollamaTools()}), cq = seen[seen.length - 1];
  ok(c.message.tool_calls && c.message.tool_calls[0].function.name === 'status' && c.usage.cost === COST && cq.max_tokens === 600 && Array.isArray(cq.tools) && !('reasoning_effort' in cq), 'chat(): tool call parsed, estimated_cost counted, max_tokens, no reasoning_effort');
  e = await err(ad.chat({model: NOTOOLS, messages: [{role: 'user', content: 'hi'}], tools: ollamaTools()}));
  ok(e && e.noTools === true, 'a model with no tool support fails with noTools (the loop switches to JSON actions)');
}

console.log('huggingface through the relay');
{
  const env = {HF_TOKEN: TOKEN, HF_BASE_URL: url, HF_MODEL: L8, HF_MODELS: CURATED.join(',')}, lines = [];
  ok(PROVIDERS.includes('huggingface') && !isLocal('huggingface'), 'huggingface is a relay provider, not local');
  const lim = makeLimits({}); ok(lim.huggingface && lim.huggingface !== lim.openai, 'huggingface has its own limiter (RELAY_HF_CONCURRENCY, default 4)');
  const mr = createRelay({client: null, providers: makeProviders({env}), limits: lim, timeoutMs: 1500, log: m => lines.push(m)});
  await new Promise(r => mr.server.listen(0, '127.0.0.1', r));
  const mb = `http://127.0.0.1:${mr.server.address().port}`, post = body => fetch(mb + '/decide', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)});
  let r = await post({...town, provider: 'huggingface', model: NOCOST}), j = await r.json();
  ok(r.status === 200 && j.choice === 'Thornvale' && j.provider === 'huggingface' && j.model === NOCOST, 'townPlan: a valid answer, provider huggingface');
  r = await post({...town, provider: 'huggingface'}); j = await r.json(); ok(r.status === 200 && j.model === L8 && j.usage.cost === COST, "no model in the request -> HF_MODEL; the cost is the reply's estimated_cost");
  r = await post({...town, provider: 'huggingface', model: NOSCHEMA}); j = await r.json(); ok(r.status === 200 && j.choice === 'Thornvale', 'a provider without json_schema still answers (json_object fallback, validated)');
  r = await post({...town, provider: 'huggingface', model: Q7}); j = await r.json(); ok(r.status === 502 && /not supported/.test(j.error), 'model_not_supported fails the request (scripted plays)');
  st.mode = 'quota'; r = await post({...town, provider: 'huggingface'}); j = await r.json(); ok(r.status === 502 && /allowance used up/.test(j.error), 'an exhausted allowance: the request fails (scripted plays)'); st.mode = 'ok';
  r = await fetch(mb + '/health'); j = await r.json();
  ok(j.providers.huggingface.ok && JSON.stringify(j.providers.huggingface.models) === JSON.stringify([L8, NOSCHEMA, NOTOOLS, NOCOST]) && j.providers.huggingface.default === L8 && !j.providers.huggingface.local && j.queues.huggingface, "/health lists the verified curated models (not the router's whole list) and the queue");
  ok(!lines.concat([JSON.stringify(j)]).some(l => l.includes(TOKEN)), 'the token appears in no log line or /health');
  await new Promise(r => mr.server.close(r));
}

console.log('agent loop, runner checks and mind tables');
{
  const ad = mk(), calls = [], game = async tool => {calls.push(tool); return {ok: true}};
  const r = await localTurn({chat: ad.chat, call: game, sess: {system: 'You are Ann.'}, prompt: 'Begin.', model: L8});
  ok(calls[0] === 'status' && r.narration === 'The hero looked about.' && r.costKnown !== false && Math.abs(r.cost - 2 * COST) < 1e-12, 'a turn over chat(): the tool reaches the game, the turn cost is the sum of estimated_cost');
  const r2 = await localTurn({chat: ad.chat, call: game, sess: {system: 'You are Ann.'}, prompt: 'Begin.', model: NOCOST});
  ok(r2.costKnown === false, 'a model with no estimated_cost: the turn cost is unknown');
  const r3 = await localTurn({chat: ad.chat, call: game, sess: {system: 'You are Ann.'}, prompt: 'Begin.', model: NOTOOLS});
  ok(r3.mode === 'json' && r3.narration === 'The hero waited.', 'a model with no tool support switches to the JSON-actions fallback');
  const a = await openaiRunner({provider: 'huggingface', model: null}, {}, {});
  ok(a.error && /HF_TOKEN/.test(a.error) && !/OPENAI/.test(a.error), 'a huggingface runner without HF_TOKEN says so');
  const b = await openaiRunner({provider: 'huggingface', model: null}, {HF_TOKEN: TOKEN, HF_BASE_URL: url}, {explicit: false});
  ok(b.error && /No Hugging Face model chosen/.test(b.error) && b.error.includes(HF_MODELS[0]), 'no model -> asks for --model or HF_MODEL and lists the picker list');
  const c = await openaiRunner({provider: 'huggingface', model: L8}, {HF_TOKEN: TOKEN, HF_BASE_URL: url, HF_MODELS: CURATED.join(',')}, {explicit: true});
  ok(c.adapter && c.adapter.name === 'huggingface' && c.model === L8, 'a huggingface runner gets the huggingface adapter');
  ok(RUNNER_PROVIDERS.includes('huggingface') && SETUP_PROVIDERS.includes('huggingface') && MIND_PROVIDERS.includes('huggingface') && PROVIDER_LABEL.huggingface === 'Hugging Face', 'runner, setup and mind provider tables include huggingface');
  ok(modelTag({provider: 'huggingface', model: L8}) === L8 + ' · huggingface', 'the model tag reads "model · huggingface"');
  const s = checkStart({kind: 'hero', hero: 7, provider: 'huggingface', model: L8}, [{id: 7, name: 'Ann', alive: true}], {});
  ok(!s.error && s.req.provider === 'huggingface' && s.req.model === L8, 'the runner start accepts provider huggingface with an org/model id' + (s.error ? ': ' + s.error : ''));
}

console.log('npm run agent -- --provider huggingface (mock router, headless world)');
{
  const tmp = mkTmp('eldmoor-hfcheck-'), kids = [];
  const env = {...process.env, AGENT_LOGS: tmp, ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', HF_TOKEN: TOKEN, HF_BASE_URL: url, HF_MODELS: CURATED.join(','), AGENT_MIN_GAP: '0', AGENT_HEARTBEAT: '30', AGENT_REFLECT: '0'};
  delete env.HF_MODEL;
  const start = (args, {wait: ready = null, e = env} = {}) => {
    const p = spawn(process.execPath, args, {cwd: ROOT, env: e, stdio: ['ignore', 'pipe', 'pipe']}); kids.push(p); let out = '';
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
    const done = new Promise(r => p.on('exit', code => r(code)));
    const until = ready ? new Promise((res, rej) => {const t = setInterval(() => {if (ready.test(out)) {clearInterval(t); res()}}, 100); setTimeout(() => {clearInterval(t); rej(new Error('timeout waiting for ' + ready + '\n' + out))}, 120000)}) : null;
    return {p, done, until, out: () => out};
  };
  const port = 19800 + Math.floor(Math.random() * 150), BASE = `http://127.0.0.1:${port}`, health = () => fetch(BASE + '/play/health').then(r => r.json());
  const world = start(['scripts/play-headless.mjs', '--port', String(port), '--agents', '2', '--quiet', '--speed', '8', '--world', join(tmp, 'world.json')], {wait: /^\[play\] headless world at /m});
  await world.until;
  const [hA, hB] = (await health()).heroes;
  const run = start(['scripts/agent-player.mjs', '--url', BASE, '--hero', String(hA.id), '--provider', 'huggingface', '--model', L8, '--max-turns', '2', '--budget', '1']);
  let tagged = null; for (let i = 0; i < 100 && !tagged; i++) {await sleep(100); const h = await health().catch(() => null); const x = h && h.heroes.find(y => y.id === hA.id); if (x && x.runner) tagged = x}
  ok(tagged && tagged.runner.provider === 'huggingface' && tagged.runner.model === L8, 'while it runs, the claim tags the runner: ' + (tagged && JSON.stringify(tagged.runner)));
  const code = await run.done, out = run.out();
  ok(code === 0, 'the huggingface runner exits cleanly' + (code ? '\n' + out.slice(-1500) : ''));
  ok(/via Hugging Face/.test(out) && /> status\(\)/.test(out), 'it plays through the game tools');
  ok((out.match(/\[turn \d\] .*\(huggingface\).*\| turn \$0\.0000\d+ \| run \$0\.0000\d+ \| session \$/g) || []).length === 2, 'two turn lines with the real (estimated) cost and the "| run $" the app runner reads');
  const f = join(tmp, 'agents', hA.id + '.json'), sf = existsSync(f) && JSON.parse(readFileSync(f, 'utf8'));
  ok(sf && sf.runner.provider === 'huggingface' && sf.runner.model === L8 && sf.turns === 2 && sf.costUsd > 0, 'the session file keeps the runner settings, turns and cost');
  ok(!out.includes(TOKEN), 'the token is not in the runner output');
  const nt = start(['scripts/agent-player.mjs', '--url', BASE, '--hero', String(hB.id), '--provider', 'huggingface', '--model', L8, '--max-turns', '1', '--new'], {e: {...env, HF_TOKEN: ''}}); const c2 = await nt.done;
  ok(c2 === 1 && /No HF_TOKEN/.test(nt.out()), 'no token: refused with the steps to create one');
  world.p.kill(); for (const k of kids) try {k.kill()} catch {}
  // the DM on the router (#824), and the two models that need the loop's fallbacks
  await dmMindCases({provider: 'huggingface', model: L8, env, ok, port: port + 200, seen, pricey: {model: PRICEY, budget: .04}});
  {const P = port + 210, B = `http://127.0.0.1:${P}`, w = start(['scripts/play-headless.mjs', '--port', String(P), '--dm', '--agents', '0', '--quiet', '--no-behavior', '--no-mirror', '--speed', '4', '--world', join(tmp, 'dmworld.json')], {wait: /^\[play\] headless world at /m});
    await w.until;
    const a = start(['scripts/dm-agent.mjs', '--url', B, '--provider', 'huggingface', '--model', NOCOST, '--max-turns', '1', '--cadence', '5']), ca = await a.done, oa = a.out();
    ok(ca === 0 && /reports no price/.test(oa) && /cost unknown \(model not in the price table\)/.test(oa) && /cost unknown for org\/no-cost, counted/.test(oa), 'a DM on a model with no estimated_cost says the budget cannot limit it' + (ca === 0 ? '' : '\n' + oa.slice(-1200)));
    const b = start(['scripts/dm-agent.mjs', '--url', B, '--provider', 'huggingface', '--model', NOTOOLS, '--max-turns', '1', '--cadence', '5']), cb = await b.done, ob = b.out();
    ok(cb === 0 && /JSON-action mode/.test(ob), 'a DM on a model with no tool support plays through the JSON actions' + (cb === 0 ? '' : '\n' + ob.slice(-1200)));
    w.p.kill()}
  try {rmSync(tmp, {recursive: true, force: true})} catch {}
}
server.close();
if (fail) {console.error(`\n${fail} check(s) FAILED`); process.exit(1)}
console.log('\nhfcheck: all ok (mock router only; no live Hugging Face call was made)');
