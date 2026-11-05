// OpenAI provider check (Mixed minds, issue #97). No network and no API key: a mock OpenAI server
// (scripts/mock-openai.mjs) stands in for api.openai.com, so this runs in CI. No live call is made;
// nothing here reads OPENAI_API_KEY from the real environment (the mock accepts only its own test key).
//   1. The adapter: strict JSON-schema structured output, the request shape, usage and cost from the
//      price table (a dated snapshot priced as its family, an unlisted model "unknown"), the models
//      list filtered to chat models, reasoning_effort sent and dropped for a model that rejects it,
//      errors mapped (401, 429 + retry-after, quota, refusal, cut off, no model, unknown model), and
//      the key never in an error message or the output.
//   2. Through the relay (createRelay): /decide with provider openai (valid, a choice outside the
//      options, a 429 on a decision and on a writing kind that the limiter retries, a refusal, cut
//      off), /health lists the models, cost lands in the stats.
//   3. The agent loop (scripts/local-agent.mjs) over the adapter's chat(): tool calls, ids and
//      arguments as the real API wants them, a bad tool answered with an error, narration, real cost.
//   4. End to end as the owner runs it: `agent-player.mjs --provider openai` against a headless world
//      (claim tag, session file, "| run $" turn lines, the budget stopping the run, no key / unknown
//      model refusals) and a one-turn Fellowship of OpenAI members.
// Usage: npm run openaicheck
import {fitTools, TOOL_DESC_MAX} from './providers/openai.mjs';
import {dmMindCases} from './dm-mind-cases.mjs';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync, readFileSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startMockOpenAI, KEY} from './mock-openai.mjs';
import {makeProviders, modelListFrom} from './providers/index.mjs';
import {openaiAdapter, costOf, priceFor, isChatModel, toOpenAI, PRICES, PRICES_SOURCE} from './providers/openai.mjs';
import {createRelay, makeLimits} from './relay.mjs';
import {localTurn, ollamaTools} from './local-agent.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const mock = await startMockOpenAI();
const town = {kind: 'townPlan', snapshot: {fac: 'Warband', name: 'Test', options: ['Thornvale', 'Mirefen']}};
const schema = {type: 'object', additionalProperties: false, required: ['line'], properties: {line: {type: 'string'}}};
const err = async p => {try {await p; return null} catch (e) {return e}};

console.log('openai adapter (mock server)');
{
  const ad = openaiAdapter({apiKey: KEY, baseUrl: mock.url});
  ok(ad.name === 'openai' && !ad.local && ad.configured() && ad.defaultModel === null, 'no default model in code (the caller or OPENAI_MODEL chooses)');
  const s = await ad.status();
  ok(s.ok && JSON.stringify(s.models) === '["gpt-6-luna","gpt-4o-mini","gpt-6-astra","gpt-future-1"]', 'status lists only chat models from GET /models, cheapest first, unpriced last (' + s.models.join(', ') + ')');
  ok(s.prices && s.prices['gpt-6-luna'].in === 0.10 && s.prices['gpt-6-luna'].out === 0.50 && !('gpt-future-1' in s.prices), 'status carries the price table rows for the picker labels (none for an unpriced model)');
  {const al = await openaiAdapter({apiKey: KEY, baseUrl: mock.url, allow: ['gpt-6-astra', 'gpt-6-luna', 'gpt-nonesuch']}).status();
   ok(JSON.stringify(al.models) === '["gpt-6-astra","gpt-6-luna"]' && JSON.stringify(al.dropped) === '["gpt-nonesuch"]', 'OPENAI_MODELS: exactly the allowed ids the key can use, in the order given; an unusable id is dropped and reported (' + JSON.stringify(al) + ')');
   const via = makeProviders({env: {OPENAI_API_KEY: KEY, OPENAI_BASE_URL: mock.url, OPENAI_MODELS: 'gpt-6-luna gpt-4o-mini'}}), vs = await via.openai.status();
   ok(JSON.stringify(vs.models) === '["gpt-6-luna","gpt-4o-mini"]' && modelListFrom({}, 'X') === null && modelListFrom({X: 'a,b'}, 'X').join() === 'a,b', 'modelListFrom reads the env list; the provider list uses it');
   const { priceLabel } = await import('../src/ui/pricelabel.js');
   ok(priceLabel(s, 'gpt-6-luna') === ' · $0.10 / $0.50 per 1M' && priceLabel(s, 'gpt-future-1') === ' · price unknown' && priceLabel({}, 'x') === '', 'the picker label: price per 1M, "price unknown", nothing without prices');}
  ok(isChatModel('gpt-6.1-sol') && isChatModel('o3-mini') && !isChatModel('whisper-1') && !isChatModel('text-embedding-3-small') && !isChatModel('gpt-5.3-codex'), 'chat filter: gpt-/o-series in; embeddings, speech, images, moderation, codex out');
  ok(s.note && /pick a model/.test(s.note) && s.default === null, 'with no default the status asks the owner to pick');
  const r = await ad.call({system: 'You are a hero.', user: '{"x":1}', schema, maxTokens: 60, model: 'gpt-6-luna'}), q = mock.seen[mock.seen.length - 1];
  ok(r.text === '{"line":"Mud and patience."}' && r.model === 'gpt-6-luna-2026-01-01', 'a structured decision returns the reply text and the model that answered');
  ok(q.response_format.type === 'json_schema' && q.response_format.json_schema.strict === true && q.response_format.json_schema.schema.additionalProperties === false, 'request: strict json_schema response_format with the schema');
  ok(q.max_completion_tokens === 60 && q.reasoning_effort === 'none' && q.messages[0].role === 'system' && q.messages[1].content === '{"x":1}' && !('max_tokens' in q), 'request: max_completion_tokens, reasoning_effort none, system + user messages');
  ok(r.usage.in === 1000 && r.usage.out === 20 && Math.abs(r.usage.cost - (1000 * 0.10 + 20 * 0.50) / 1e6) < 1e-12 && r.usage.costKnown, 'usage from prompt/completion tokens, cost from the price table (the dated snapshot is priced as gpt-6-luna)');
  ok(priceFor('gpt-4o-2024-08-06') === PRICES['gpt-4o'] && costOf('nope-1', 10, 10) === null && /developers\.openai\.com\/api\/docs\/pricing \(read 2026-11-01\)/.test(PRICES_SOURCE), 'a dated snapshot maps to its family; an unlisted model has no price; the table cites its source and date');
  const u = await ad.call({system: 's', user: 'u', schema, maxTokens: 60, model: 'gpt-future-1'});
  ok(u.usage.in === 1000 && u.usage.cost === 0 && u.usage.costKnown === false && u.usage.costNote === 'unknown', 'an unlisted model reports tokens with cost unknown');
  // cached input (#728): prompt_tokens_details.cached_tokens is priced at the cached rate; no field = as before
  mock.setCached(800);
  const cr = await ad.call({system: 's', user: 'u', schema, maxTokens: 60, model: 'gpt-6-luna'}), cu = await ad.call({system: 's', user: 'u', schema, maxTokens: 60, model: 'gpt-6-astra'});
  ok(cr.usage.in === 1000 && cr.usage.cached === 800 && Math.abs(cr.usage.cost - (200 * 0.10 + 800 * 0.01 + 20 * 0.50) / 1e6) < 1e-12, 'a reply with cached tokens: in stays the whole prompt, cached is split out and priced at the cached rate');
  ok(PRICES['gpt-6.1-terra'].cached === 0.05 && PRICES['gpt-6-luna'].cached === 0.01 && Math.abs(costOf('gpt-6.1-terra', 4449, 56, 3900) - (549 * 1 + 3900 * 0.05 + 56 * 5) / 1e6) < 1e-12 && costOf('gpt-6-luna', 1000, 20, 5000) === costOf('gpt-6-luna', 1000, 20, 1000), 'terra and luna carry a cached price; cached is capped at the prompt');
  ok(cu.usage.cached === 800 && Math.abs(cu.usage.cost - (1000 * 10 + 20 * 50) / 1e6) < 1e-12, 'a model with no cached price keeps the full input rate (an upper bound)');
  mock.setCached(0);
  const c0 = await ad.call({system: 's', user: 'u', schema, maxTokens: 60, model: 'gpt-6-luna'});
  ok(!('cached' in c0.usage) && Math.abs(c0.usage.cost - (1000 * 0.10 + 20 * 0.50) / 1e6) < 1e-12, 'a reply without the field prices exactly as before');
  // reasoning_effort: a model that rejects it is asked again without, and remembered
  const n0 = mock.seen.length; await ad.call({system: 's', user: 'u', schema, maxTokens: 60, model: 'gpt-4o-mini'}); await ad.call({system: 's', user: 'u', schema, maxTokens: 60, model: 'gpt-4o-mini'});
  ok(mock.seen.length === n0 + 3 && !('reasoning_effort' in mock.seen[mock.seen.length - 1]), 'a model that rejects reasoning_effort is asked again without it, and remembered');
  // errors
  let e = await err(ad.call({system: 's', user: 'u', schema, maxTokens: 60}));
  ok(e && /no model chosen/.test(e.message), 'no model and no default -> asks to pick one');
  e = await err(ad.call({system: 's', user: 'u', schema, maxTokens: 60, model: 'gpt-nope'}));
  ok(e && /not found or not available/.test(e.message), '404 -> model not found');
  e = await err(openaiAdapter({apiKey: 'sk-wrong-key-123456', baseUrl: mock.url}).call({system: 's', user: 'u', schema, maxTokens: 60, model: 'gpt-6-luna'}));
  ok(e && e.message === 'openai: bad or missing key' && e.status === 401 && !/sk-wrong/.test(e.message + JSON.stringify(e)), '401 -> "bad or missing key", the key is not echoed');
  const bad = await openaiAdapter({apiKey: 'sk-wrong-key-123456', baseUrl: mock.url}).status();
  ok(!bad.ok && /bad or missing key/.test(bad.error) && !/sk-wrong/.test(JSON.stringify(bad)), 'status with a bad key says so without the key');
  const none = openaiAdapter({baseUrl: mock.url}); e = await err(none.call({system: 's', user: 'u', schema, maxTokens: 60, model: 'gpt-6-luna'}));
  ok(!none.configured() && e && /not configured/.test(e.message) && !(await none.status()).ok, 'no key: not configured, status not ok, call fails');
  mock.set('rate', 1); e = await err(ad.call({system: 's', user: 'u', schema, maxTokens: 60, model: 'gpt-6-luna'}));
  ok(e && /rate limit \(retry after 1 s\)/.test(e.message) && e.status === 429 && e.retryAfter === 1 && e.headers['retry-after'] === '1', '429 -> "rate limit", with retry-after (the relay limiter reads err.status and err.headers)');
  mock.set('quota'); e = await err(ad.call({system: 's', user: 'u', schema, maxTokens: 60, model: 'gpt-6-luna'}));
  ok(e && /out of credit/.test(e.message), '429 insufficient_quota -> out of credit (not a rate limit)');
  mock.set('refusal'); e = await err(ad.call({system: 's', user: 'u', schema, maxTokens: 60, model: 'gpt-6-luna'}));
  ok(e && e.message === 'model refused' && e.raw === "I can't help with that." && e.result.usage.in === 1000, 'refusal field -> "model refused" (tokens still counted)');
  mock.set('length'); e = await err(ad.call({system: 's', user: 'u', schema, maxTokens: 60, model: 'gpt-6-luna'}));
  ok(e && e.message === 'reply cut off' && e.result.usage.out === 20, 'finish_reason length -> "reply cut off"');
  mock.set('ok');
  const cs = await ad.chat({model: 'gpt-6-luna', messages: [{role: 'user', content: 'Begin.'}], tools: ollamaTools(), maxTokens: 100}), cq = mock.seen[mock.seen.length - 1];
  ok(cs.message.tool_calls && cs.message.tool_calls[0].function.name === 'status' && typeof cs.message.tool_calls[0].function.arguments === 'object', 'chat: tool_calls come back with parsed arguments');
  ok(cq.tools.length === ollamaTools().length && cq.tools[0].type === 'function' && cq.reasoning_effort === 'none', 'chat: the tools are sent as function tools, reasoning_effort none (Chat Completions needs it for tool calls)');
  const t = toOpenAI([{role: 'user', content: 'a'}, {role: 'assistant', content: '', tool_calls: [{function: {name: 'look', arguments: {}}}, {function: {name: 'wait', arguments: {minutes: 5}}}]}, {role: 'tool', tool_name: 'look', content: '{}'}, {role: 'user', content: 'next'}, {role: 'tool', tool_name: 'x', content: 'orphan'}]);
  ok(t[1].tool_calls.length === 2 && t[1].tool_calls[1].function.arguments === '{"minutes":5}' && t[2].tool_call_id === t[1].tool_calls[0].id && t[3].tool_call_id === t[1].tool_calls[1].id && t[3].content === '(not run)' && t[4].role === 'user' && t[5].role === 'user' && /orphan/.test(t[5].content), 'message translation: ids, JSON-string arguments, unanswered calls filled, orphan tool results become text');
  // a function description past the API's limit (#824): cut at a sentence, the rest in the system message, the shorter ones untouched
  {const long = 'First rule here. '.repeat(100).trim(), f = fitTools([{type: 'function', function: {name: 'big', description: long}}, {type: 'function', function: {name: 'small', description: 'short'}}], [{role: 'system', content: 'Orders.'}, {role: 'user', content: 'go'}]);
   const d = f.tools[0].function.description, more = f.messages[0].content.split('big: ')[1];
   ok(d.length <= TOOL_DESC_MAX && /\. \(more in your orders\)$/.test(d) && d.replace(' (more in your orders)', '').length + more.length + 1 === long.length && f.tools[1].function.description === 'short' && f.messages[0].content.startsWith('Orders.'), 'fitTools: nothing is lost and the description fits (' + d.length + ')');
   const same = [{type: 'function', function: {name: 's', description: 'short'}}], m0 = [{role: 'user', content: 'x'}], g = fitTools(same, m0); ok(g.tools === same && g.messages === m0, 'fitTools leaves a request that fits alone')}
  // chat retries a 429 by itself (an agent turn has seconds to spare), up to its wait budget
  mock.set('rate', 1); const t0 = Date.now(); const rr = await ad.chat({model: 'gpt-6-luna', messages: [{role: 'user', content: 'x'}], tools: ollamaTools()});
  ok(rr.message && Date.now() - t0 >= 900 && Date.now() - t0 < 5000, 'chat: a 429 waits retry-after and tries again (' + (Date.now() - t0) + ' ms)');
  mock.set('ok');
}

console.log('openai through the relay');
{
  const env = {OPENAI_API_KEY: KEY, OPENAI_BASE_URL: mock.url, OPENAI_MODEL: 'gpt-6-luna'};
  const lines = [], mr = createRelay({client: null, providers: makeProviders({env}), limits: makeLimits({}), timeoutMs: 1500, log: m => lines.push(m)});
  await new Promise(r => mr.server.listen(0, '127.0.0.1', r));
  const mb = `http://127.0.0.1:${mr.server.address().port}`;
  const post = body => fetch(mb + '/decide', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)});
  const oa = {...town, provider: 'openai', model: 'gpt-6-luna'};
  let r = await post(oa), j = await r.json();
  ok(r.status === 200 && j.choice === 'Thornvale' && j.provider === 'openai' && j.model === 'gpt-6-luna-2026-01-01' && j.reason, 'townPlan: a valid structured answer, provider and model named');
  ok(j.usage.in === 1000 && j.usage.cost > 0 && j.usage.cost < 0.001, 'cost from the price table reaches the reply (' + j.usage.cost + ')');
  ok(lines.some(l => /townPlan Test openai\/gpt-6-luna-2026-01-01 in=1000 out=20 \$0\.000110/.test(l)), 'the relay log records provider/model and cost, no key');
  r = await post({...town, provider: 'openai'}); j = await r.json(); ok(r.status === 200 && j.model.startsWith('gpt-6-luna'), 'no model in the request -> OPENAI_MODEL');
  mock.set('invalid'); r = await post(oa); j = await r.json(); ok(r.status === 502 && /not in options/.test(j.error) && j.provider === 'openai', 'a choice outside the options is rejected like any other provider\'s');
  mock.set('refusal'); r = await post(oa); j = await r.json(); ok(r.status === 502 && j.error === 'model refused', 'a refusal -> "model refused" (the sim plays scripted)');
  mock.set('length'); r = await post(oa); j = await r.json(); ok(r.status === 502 && j.error === 'reply cut off', 'cut off -> "reply cut off"');
  mock.set('rate', 1); r = await post(oa); j = await r.json(); ok(r.status >= 429 && /rate limit/.test(j.error), 'a 429 on a decision is dropped at once (scripted plays), never queued late');
  mock.set('rate', 1); const t0 = Date.now(); r = await post({kind: 'memory', snapshot: {fac: 'Warband', name: 'Test'}, provider: 'openai'}); j = await r.json();
  ok(r.status === 200 && j.long && Date.now() - t0 >= 900, 'a 429 on a writing kind pauses the limiter and is retried after retry-after (' + (Date.now() - t0) + ' ms)');
  mock.set('ok');
  r = await fetch(mb + '/health'); j = await r.json();
  ok(j.providers.openai.ok && JSON.stringify(j.providers.openai.models) === '["gpt-6-luna","gpt-4o-mini","gpt-6-astra","gpt-future-1"]' && j.providers.openai.default === 'gpt-6-luna' && !j.providers.openai.local, '/health lists the OpenAI chat models for the mind row picker, cheapest first');
  ok(j.byProvider.openai.requests >= 7 && j.byProvider.openai.cost > 0 && j.queues && j.queues.openai && j.queues.openai.rateLimited >= 2, '/health counts OpenAI calls, cost and 429s per provider (' + j.byProvider.openai.requests + ' calls)');
  const none = createRelay({client: null, providers: makeProviders({env: {}}), limits: makeLimits({}), log: () => {}});
  await new Promise(r => none.server.listen(0, '127.0.0.1', r));
  const nb = `http://127.0.0.1:${none.server.address().port}`;
  r = await fetch(nb + '/decide', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(oa)}); j = await r.json();
  const h = await fetch(nb + '/health').then(x => x.json());
  ok(r.status === 502 && /not configured/.test(j.error) && !h.providers.openai.ok && /no OPENAI_API_KEY/.test(h.providers.openai.error), 'without a key: the request fails (scripted plays) and /health says OpenAI is not configured');
  ok(!lines.concat([JSON.stringify(j), JSON.stringify(h)]).some(l => l.includes(KEY)), 'the key appears in no log line, reply or /health');
  await new Promise(r => mr.server.close(r)); await new Promise(r => none.server.close(r));
}

console.log('agent loop over the OpenAI adapter');
{
  const { paidLine } = await import('./local-agent.mjs');
  const base = {tools: 1, ms: 1000, modelMs: 500, modelCalls: 2, in: 4449, out: 56, cost: 0.001, costKnown: true};
  ok(/tokens in 4449 \(3900 cached\) \/ out 56/.test(paidLine({...base, cached: 3900}, 'gpt-6.1-terra', 'openai')) && /tokens in 4449 \/ out 56/.test(paidLine(base, 'gpt-6.1-terra', 'openai')), 'the turn line shows the cached split, and none when nothing was cached');
}
{
  const ad = openaiAdapter({apiKey: KEY, baseUrl: mock.url}), calls = [], game = async (tool, args) => {calls.push([tool, args]); return {ok: true, tool}};
  const sess = {system: 'You are Ann.'}, got = [];
  mock.problems.length = 0;
  let r = await localTurn({chat: ad.chat, call: game, sess, prompt: 'Begin.', model: 'gpt-6-luna', on: (k, a) => got.push([k, a])});
  ok(calls.map(c => c[0]).join(',') === 'status,rest,wait' && calls[1][1].minutes === 20 && r.rejected === 1 && /Not done: unknown tool/.test(got.filter(g => g[0] === 'result')[2][1]), 'tool calls reach the game validated (the bad tool is answered with an error, never sent)');
  ok(r.narration === 'The hero looked, rested and waited.' && r.modelCalls === 5, 'the turn ends with the narration after the wait (' + r.modelCalls + ' model calls)');
  ok(r.in === 5000 && r.out === 100 && Math.abs(r.cost - 5 * (1000 * 0.10 + 20 * 0.50) / 1e6) < 1e-12 && r.costKnown, 'the turn counts real tokens and cost (' + r.cost.toFixed(6) + ')');
  r = await localTurn({chat: ad.chat, call: game, sess, prompt: 'Turn 2.', model: 'gpt-6-luna'});
  ok(mock.problems.length === 0 && r.narration, 'a second turn replays the stored history in the shape the API demands' + (mock.problems.length ? ': ' + mock.problems.join('; ') : ''));
  r = await localTurn({chat: ad.chat, call: game, sess: {system: 's'}, prompt: 'Begin.', model: 'gpt-future-1'});
  ok(r.costKnown === false && r.cost === 0 && r.in === 5000, 'an unlisted model: tokens counted, cost unknown');
}

// ---------------------------------------------------------------- end to end
const tmp = mkdtempSync(join(tmpdir(), 'eldmoor-openaicheck-'));
const kids = [];
const cleanEnv = {...process.env, AGENT_LOGS: tmp, ANTHROPIC_API_KEY: '', OPENAI_API_KEY: KEY, OPENAI_BASE_URL: mock.url, AGENT_MIN_GAP: '0', AGENT_HEARTBEAT: '30', AGENT_REFLECT: '0'}; // no reflection turns (#179) where turn counts are exact
delete cleanEnv.OPENAI_MODEL;
function start(args, {wait: ready = null, env = cleanEnv} = {}) {
  const p = spawn(process.execPath, args, {cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe']});
  kids.push(p); let out = '';
  p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
  const done = new Promise(r => p.on('exit', code => r(code)));
  const until = ready ? new Promise((res, rej) => {const t = setInterval(() => {if (ready.test(out)) {clearInterval(t); res()}}, 100); setTimeout(() => {clearInterval(t); rej(new Error('timeout waiting for ' + ready + '\n' + out))}, 120000)}) : null;
  return {p, done, until, out: () => out};
}
const port = 19300 + Math.floor(Math.random() * 500), BASE = `http://127.0.0.1:${port}`;
const health = base => fetch(base + '/play/health').then(r => r.json());

console.log('npm run agent -- --provider openai (mock OpenAI, headless world on port ' + port + ')');
const world = start(['scripts/play-headless.mjs', '--port', String(port), '--agents', '2', '--quiet', '--speed', '8', '--world', join(tmp, 'world.json')], {wait: /^\[play\] headless world at /m});
await world.until;
const h0 = await health(BASE), [hA, hB] = h0.heroes;
{
  mock.problems.length = 0; const a0 = mock.auths.length;
  const run = start(['scripts/agent-player.mjs', '--url', BASE, '--hero', String(hA.id), '--provider', 'openai', '--model', 'gpt-6-luna', '--max-turns', '2', '--budget', '1']);
  let tagged = null; for (let i = 0; i < 100 && !tagged; i++) {await sleep(100); const h = await health(BASE).catch(() => null); const x = h && h.heroes.find(y => y.id === hA.id); if (x && x.runner) tagged = x}
  ok(tagged && tagged.runner.provider === 'openai' && tagged.runner.model === 'gpt-6-luna', `while it runs, the claim tags ${hA.name}'s runner: ${tagged && JSON.stringify(tagged.runner)}`);
  const code = await run.done, out = run.out();
  ok(code === 0, 'the OpenAI runner exits cleanly' + (code ? '\n' + out : ''));
  ok(/via OpenAI/.test(out) && /> status\(\)/.test(out) && /> wait\(/.test(out) && /Not done: unknown tool/.test(out), 'it plays through the game tools; a bad call is answered with an error');
  ok((out.match(/\[turn \d\] gpt-6-luna \(openai\) \| 4 tool calls \(1 rejected\).*tokens in 5000 \/ out 100 \| turn \$0\.0006 \| run \$0\.00\d+ \| session \$0\.00\d+/g) || []).length === 2, 'two turn lines with real cost, the "| run $" the app runner reads');
  const f = join(tmp, 'agents', hA.id + '.json'), s = existsSync(f) && JSON.parse(readFileSync(f, 'utf8'));
  ok(s && s.runner.provider === 'openai' && s.runner.model === 'gpt-6-luna' && s.turns === 2 && s.costUsd > 0.001 && s.local.history.length > 0, 'the session file keeps the runner settings, turns, cost and the conversation');
  ok(!out.includes(KEY) && mock.auths.slice(a0).every(a => a === 'Bearer ' + KEY), 'the key is not in the runner output (only the Authorization header carried it)');
  ok(mock.problems.length === 0, 'every request had a valid tool-message shape' + (mock.problems.length ? ': ' + mock.problems.slice(0, 3).join('; ') : ''));
  const again = start(['scripts/agent-player.mjs', '--url', BASE, '--hero', String(hA.id), '--max-turns', '1']);
  const c2 = await again.done, o2 = again.out(), s2 = JSON.parse(readFileSync(f, 'utf8'));
  ok(c2 === 0 && /resuming \(\d+ messages kept\)/.test(o2) && s2.turns === 3, 'the next run resumes from the saved settings with no flags' + (c2 === 0 ? '' : '\n' + o2.slice(-1500)));
}
{
  const run = start(['scripts/agent-player.mjs', '--url', BASE, '--hero', String(hB.id), '--provider', 'openai', '--model', 'gpt-6-astra', '--max-turns', '5', '--budget', '0.05']);
  const code = await run.done, out = run.out();
  ok(code === 0 && /budget reached/.test(out) && (out.match(/\[turn \d\]/g) || []).length === 1, 'the budget caps the run (a pricey model, $0.05: one turn, then "budget reached")' + (code === 0 ? '' : '\n' + out.slice(-1500)));
  const c3 = await start(['scripts/agent-player.mjs', '--url', BASE, '--hero', String(hB.id), '--provider', 'openai', '--model', 'gpt-nope', '--max-turns', '1', '--new']).done;
  ok(c3 === 1, 'a model that is not in the key\'s list is refused');
  const nm = start(['scripts/agent-player.mjs', '--url', BASE, '--hero', String(hB.id), '--provider', 'openai', '--max-turns', '1', '--new']); const c4 = await nm.done;
  ok(c4 === 1 && /No OpenAI model chosen/.test(nm.out()) && /gpt-6-luna/.test(nm.out()), 'no model: the runner asks the owner to pick and lists what the key can use');
  const nk = start(['scripts/agent-player.mjs', '--url', BASE, '--hero', String(hB.id), '--provider', 'openai', '--model', 'gpt-6-luna', '--max-turns', '1', '--new'], {env: {...cleanEnv, OPENAI_API_KEY: ''}}); const c5 = await nk.done;
  ok(c5 === 1 && /No OPENAI_API_KEY/.test(nk.out()), 'no key: refused with the steps to create one');
  const hb = await health(BASE);
  ok(!hb.heroes.find(y => y.id === hB.id).runner, 'refused runners released their claim');
}
world.p.kill();

console.log('npm run fellowship -- --provider openai (headless Fellowship, mock OpenAI)');
{
  const fport = port + 1, FB = `http://127.0.0.1:${fport}`;
  const fw = start(['scripts/play-headless.mjs', '--fellowship', '--no-relay', '--port', String(fport), '--quiet', '--speed', '8', '--world', join(tmp, 'fworld.json')], {wait: /^\[play\] headless world at /m});
  await fw.until;
  const run = start(['scripts/fellowship.mjs', '--url', FB, '--provider', 'openai', '--model', 'gpt-6-luna', '--max-turns', '1', '--cadence', '0', '--budget', '1']);
  const seen = new Set(); let tags = 0; // members claim, play one turn and release at their own pace: count every member seen tagged
  for (let i = 0; i < 300 && seen.size < 5; i++) {await sleep(100); const h = await health(FB).catch(() => null); if (h) for (const x of h.heroes) if (x.runner && x.runner.provider === 'openai') seen.add(x.id)}
  tags = seen.size;
  ok(tags === 5, `every member's claim carries provider openai (${tags}/5)`);
  const code = await run.done, out = run.out();
  ok(code === 0, 'the Fellowship runner finishes' + (code ? '\n' + out.slice(-3000) : ''));
  ok((out.match(/\[turn 1(, scene)?\] gpt-6-luna \(openai\)/g) || []).length === 5 && /\| run \$0\.\d+ of \$1\.0000/.test(out), 'each of the five plays an OpenAI turn with the run total against the budget');
  ok(!out.includes(KEY), 'the key is not in the output');
  const j = JSON.parse(readFileSync(join(tmp, 'fellowship-runs.jsonl'), 'utf8').trim().split('\n').pop());
  ok(j.url === FB && j.spent > 0 && j.members.every(m => m.provider === 'openai' && m.tokensIn > 0 && m.cost > 0), 'the run record lists the members with tokens and real cost');
  fw.p.kill();
}

// the DM on OpenAI (#824): gpt-6-astra costs $0.011 a call here, so a turn of three stays under $0.04 and one voice call passes it
await dmMindCases({provider: 'openai', model: 'gpt-6-luna', env: cleanEnv, ok, port: port + 3, seen: mock.seen, pricey: {model: 'gpt-6-astra', budget: .04}});

for (const k of kids) try {k.kill()} catch {}
mock.close();
try {rmSync(tmp, {recursive: true, force: true})} catch {}
console.log(fail ? `\nopenaicheck: ${fail} FAILED` : '\nopenaicheck: all ok (mock server only; no live OpenAI call was made)');
process.exit(fail ? 1 : 0);
